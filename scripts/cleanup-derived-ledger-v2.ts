#!/usr/bin/env node
/** Supersede only stale derived ledger rows made obsolete by the V2 lineage rules. */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { firstDayOfNextMonth } from '@/lib/forecast/cutoff'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID

type Match = { olist_accounts_receivable_id: string; status: string }
type Ledger = { id: string; event_date: string; source: string; status: string; nature: string; source_event_id: string | null; metadata: Record<string, unknown> | null; superseded_at: string | null }

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const admin = createAdminSupabaseClient()
  const [matches, ledger] = await Promise.all([
    fetchAllPages<Match>((from, to) => admin.from('reconciliation_matches').select('olist_accounts_receivable_id, status').eq('org_id', orgId).range(from, to), 'Falha ao carregar reconciliações'),
    fetchAllPages<Ledger>((from, to) => admin.from('financial_ledger').select('id, event_date, source, status, nature, source_event_id, metadata, superseded_at').eq('org_id', orgId).range(from, to), 'Falha ao carregar ledger'),
  ])
  const resolvedArIds = new Set(matches.filter((row) => ['reconciliado_automaticamente', 'reconciliado_manualmente'].includes(row.status)).map((row) => row.olist_accounts_receivable_id))
  const nextMonth = firstDayOfNextMonth()
  const staleForecast = ledger.filter((row) => !row.superseded_at && row.source === 'forecast' && row.status === 'projected' && row.event_date < nextMonth)
  const staleCardAr = ledger.filter((row) => !row.superseded_at && row.source === 'olist' && row.nature === 'OLIST_AR_ACTUAL' && typeof row.metadata?.receivable_id === 'string' && resolvedArIds.has(row.metadata.receivable_id))
  const payoutEventIds = new Set(ledger.filter((row) => !row.superseded_at && row.nature === 'SUMUP_PAYOUT_SCHEDULED' && row.source_event_id).map((row) => row.source_event_id))
  const staleLegacyReceipts = ledger.filter((row) => !row.superseded_at && row.nature === 'SUMUP_RECEIPT_SCHEDULED' && row.source_event_id && payoutEventIds.has(row.source_event_id))
  const stale = [...staleForecast, ...staleCardAr, ...staleLegacyReceipts]
  const now = new Date().toISOString()
  for (let offset = 0; offset < stale.length; offset += 100) {
    const ids = stale.slice(offset, offset + 100).map((row) => row.id)
    const reason = ids.some((id) => staleForecast.some((row) => row.id === id))
      ? 'V2 forecast cutoff'
      : ids.some((id) => staleCardAr.some((row) => row.id === id))
        ? 'V2 card reconciliation: SumUp authoritative'
        : 'V2 canonical ledger: SUMUP_PAYOUT_SCHEDULED supersedes legacy receipt row'
    const { error } = await admin.from('financial_ledger').update({ superseded_at: now, supersession_reason: reason }).eq('org_id', orgId).in('id', ids)
    if (error) throw error
  }
  console.log(JSON.stringify({ SUPERSEDED_FORECAST_ROWS: staleForecast.length, SUPERSEDED_CARD_AR_ROWS: staleCardAr.length, SUPERSEDED_LEGACY_SUMUP_RECEIPTS: staleLegacyReceipts.length, NEXT_ALLOWED_FORECAST_DATE: nextMonth }, null, 2))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
