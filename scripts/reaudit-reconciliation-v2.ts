#!/usr/bin/env node
/** Reclassifies stored Tiny/SumUp links without deleting source financial rows. */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { reconcileTinyCards, type ReconciliationResult } from '@/lib/reconciliation/deterministic'
import { syncLedgerFromAllSources } from '@/lib/ledger/populate'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID
const apply = process.argv.includes('--apply')

type Ar = {
  id: string
  olist_id: number | null
  valor: number | null
  situacao: string | null
  data_emissao: string | null
  data_vencimento: string | null
  numero_documento: string | null
  forma_recebimento_nome: string | null
}
type Tx = {
  id: string
  transaction_id: string | null
  transaction_code: string | null
  amount: number | null
  timestamp_utc: string | null
  status: string | null
  simple_status: string | null
  payment_type: string | null
  installments_count: number | null
  refunded_amount: number | null
}
type Event = { id: string; transaction_id: string; event_type: string; status: string; due_date: string | null; installment_number: number | null }
type Match = { id: string; olist_accounts_receivable_id: string; sumup_transaction_id: string | null; sumup_transaction_event_id: string | null; status: string; match_reason: Record<string, unknown> | null }
type Ledger = { id: string; source: string; source_id: string | null; source_event_id: string | null; nature: string; amount: number | null; metadata: Record<string, unknown> | null; superseded_at: string | null }

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()
const dateOnly = (value: string | null | undefined) => value?.slice(0, 10) ?? null
const money = (value: number) => Math.round(value * 100) / 100
const cardMethods = new Set(['cartão de crédito', 'cartão de débito', 'cartao de credito', 'cartao de debito'])
const successStatuses = new Set(['successful', 'success'])
const badStatuses = new Set(['failed', 'failure', 'cancelled', 'canceled', 'cancelado', 'cancelada', 'refunded', 'refund', 'estornado', 'estornada'])
const isCard = (value: string | null) => cardMethods.has(norm(value))
const installmentNumber = (value: string | null) => { const match = value?.match(/\/(\d+)$/); return match ? Number(match[1]) : null }

function sharedKey(ar: Ar, tx: Tx): string | null {
  const arKeys = [ar.olist_id == null ? null : String(ar.olist_id), ar.numero_documento].map(norm).filter(Boolean)
  const txKeys = [tx.transaction_code, tx.transaction_id].map(norm).filter(Boolean)
  return arKeys.find((key) => txKeys.includes(key)) ?? null
}

function sameComposite(ar: Ar, tx: Tx): boolean {
  return Boolean(ar.valor != null && tx.amount != null && Math.abs(Number(ar.valor) - Number(tx.amount)) < 0.01 && dateOnly(ar.data_emissao || ar.data_vencimento) === dateOnly(tx.timestamp_utc) && installmentNumber(ar.numero_documento) === (tx.installments_count ?? null))
}

function classify(match: Match, ar: Ar | undefined, tx: Tx | undefined, event: Event | undefined, strictByAr: Map<string, ReconciliationResult>): { classification: string; reason: Record<string, unknown> } {
  if (match.status === 'conflito') return { classification: 'AMBIGUOUS', reason: { reason: 'stored_status_conflito', candidate_count: Array.isArray(match.match_reason?.candidatos) ? match.match_reason?.candidatos.length : undefined } }
  if (!['reconciliado_automaticamente', 'reconciliado_manualmente'].includes(match.status)) return { classification: 'INVALID', reason: { reason: 'stored_status_not_resolved' } }
  if (!ar || !tx || !event || !match.sumup_transaction_id || !match.sumup_transaction_event_id) return { classification: 'INVALID', reason: { reason: 'missing_source_or_fk' } }
  if (!isCard(ar.forma_recebimento_nome) || !['pos', 'ecom'].includes(norm(tx.payment_type))) return { classification: 'INVALID', reason: { reason: 'payment_method_not_card' } }
  if (!successStatuses.has(norm(tx.status)) && !successStatuses.has(norm(tx.simple_status))) return { classification: 'INVALID', reason: { reason: 'sumup_transaction_not_successful', status: tx.status, simple_status: tx.simple_status } }
  if (Number(tx.refunded_amount ?? 0) > 0 || badStatuses.has(norm(event.status)) || norm(event.event_type) !== 'payout') return { classification: 'INVALID', reason: { reason: 'cancelled_refunded_or_non_payout_event', event_type: event.event_type, event_status: event.status } }
  const strict = strictByAr.get(ar.id)
  if (strict?.status !== 'MATCHED' || strict.sumupId !== tx.id) return { classification: 'LEGACY_UNVERIFIED', reason: { reason: 'stored_pair_not_reproduced_by_strict_deterministic_audit', strict_status: strict?.status ?? 'not_found' } }
  const key = sharedKey(ar, tx)
  if (key) return { classification: 'VERIFIED_EXACT', reason: { method: 'shared_identifier', identifier_fingerprint: key.slice(0, 4) + '…' } }
  if (sameComposite(ar, tx)) return { classification: 'VERIFIED_COMPOSITE', reason: { method: 'exact_amount_date_installment' } }
  return { classification: 'LEGACY_UNVERIFIED', reason: { reason: 'strict_pair_without_reproducible_exact_or_composite_evidence' } }
}

async function load<T>(client: ReturnType<typeof createAdminSupabaseClient>, table: string, select: string, filter: (query: any) => any): Promise<T[]> {
  return fetchAllPages<T>((from, to) => filter(client.from(table).select(select).range(from, to)), `Falha ao carregar ${table}`)
}

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const admin = createAdminSupabaseClient()
  const [ars, txs, events, matches, ledger] = await Promise.all([
    load<Ar>(admin, 'olist_accounts_receivable', 'id, olist_id, valor, situacao, data_emissao, data_vencimento, numero_documento, forma_recebimento_nome', (q) => q.eq('org_id', orgId)),
    load<Tx>(admin, 'sumup_transactions', 'id, transaction_id, transaction_code, amount, timestamp_utc, status, simple_status, payment_type, installments_count, refunded_amount', (q) => q.eq('org_id', orgId)),
    load<Event>(admin, 'sumup_transaction_events', 'id, transaction_id, event_type, status, due_date, installment_number', (q) => q.eq('org_id', orgId)),
    load<Match>(admin, 'reconciliation_matches', 'id, olist_accounts_receivable_id, sumup_transaction_id, sumup_transaction_event_id, status, match_reason', (q) => q.eq('org_id', orgId)),
    load<Ledger>(admin, 'financial_ledger', 'id, source, source_id, source_event_id, nature, amount, metadata, superseded_at', (q) => q.eq('org_id', orgId)),
  ])
  const arById = new Map(ars.map((row) => [row.id, row]))
  const txById = new Map(txs.map((row) => [row.id, row]))
  const eventById = new Map(events.map((row) => [row.id, row]))
  const tiny = ars.filter((row) => isCard(row.forma_recebimento_nome) && Number(row.valor ?? 0) > 0)
  const sumup = txs.filter((row) => ['pos', 'ecom'].includes(norm(row.payment_type)) && (successStatuses.has(norm(row.status)) || successStatuses.has(norm(row.simple_status))) && Number(row.amount ?? 0) > 0)
  const strict = reconcileTinyCards(tiny.map((row) => ({ id: row.id, externalId: row.olist_id == null ? null : String(row.olist_id), reference: row.numero_documento, orderId: null, amount: Number(row.valor), date: dateOnly(row.data_emissao || row.data_vencimento) ?? '', installments: installmentNumber(row.numero_documento), paymentMethod: row.forma_recebimento_nome, status: row.situacao })), sumup.map((row) => ({ id: row.id, externalId: row.transaction_code, reference: row.transaction_id, orderId: null, amount: Number(row.amount), date: dateOnly(row.timestamp_utc) ?? '', installments: row.installments_count })))
  const strictByAr = new Map(strict.filter((row) => row.tinyId).map((row) => [row.tinyId as string, row]))
  const resolved = matches.filter((row) => ['reconciliado_automaticamente', 'reconciliado_manualmente'].includes(row.status) || row.status === 'conflito')
  const classifications = resolved.map((match) => { const ar = arById.get(match.olist_accounts_receivable_id); const tx = match.sumup_transaction_id ? txById.get(match.sumup_transaction_id) : undefined; const event = match.sumup_transaction_event_id ? eventById.get(match.sumup_transaction_event_id) : undefined; return { match, ar, tx, result: classify(match, ar, tx, event, strictByAr) } })
  const counts = Object.fromEntries(['VERIFIED_EXACT', 'VERIFIED_COMPOSITE', 'LEGACY_UNVERIFIED', 'AMBIGUOUS', 'INVALID'].map((key) => [key, classifications.filter((row) => row.result.classification === key).length]))
  const verified = new Set(classifications.filter((row) => ['VERIFIED_EXACT', 'VERIFIED_COMPOSITE'].includes(row.result.classification)).map((row) => row.match.id))
  const notVerifiedAr = classifications.filter((row) => !verified.has(row.match.id)).map((row) => row.match.olist_accounts_receivable_id)
  const beforeSuppressed = new Set(ledger.filter((row) => row.source === 'olist' && row.source_id && notVerifiedAr.includes(row.source_id) && row.superseded_at).map((row) => row.source_id as string))
  if (apply) {
    for (const row of classifications) {
      const merged = { ...(row.match.match_reason ?? {}), v2_classification: row.result.classification, v2_audit: row.result.reason }
      const { error } = await admin.from('reconciliation_matches').update({ match_reason: merged, updated_at: new Date().toISOString() }).eq('id', row.match.id).eq('org_id', orgId)
      if (error) throw new Error(`Falha ao gravar classificação ${row.match.id}: ${error.message}`)
    }
    const refresh = await syncLedgerFromAllSources(orgId)
    if (!refresh.success) throw new Error(`Falha ao recalcular ledger: ${refresh.error}`)
  }
  const currentLedger = apply ? await load<Ledger>(admin, 'financial_ledger', 'id, source, source_id, source_event_id, nature, amount, metadata, superseded_at', (q) => q.eq('org_id', orgId)) : ledger
  const active = currentLedger.filter((row) => !row.superseded_at)
  const activeOlist = new Set(active.filter((row) => row.source === 'olist' && row.source_id).map((row) => row.source_id as string))
  const activeSumupEvents = new Set(active.filter((row) => row.source === 'sumup' && row.source_event_id).map((row) => row.source_event_id as string))
  const missing = classifications.filter((row) => { const arId = row.match.olist_accounts_receivable_id; if (['VERIFIED_EXACT', 'VERIFIED_COMPOSITE'].includes(row.result.classification)) return !row.match.sumup_transaction_event_id || !activeSumupEvents.has(row.match.sumup_transaction_event_id); return !activeOlist.has(arId) }).filter((row) => Number(row.ar?.valor ?? 0) > 0)
  const restoredIds = [...beforeSuppressed].filter((id) => activeOlist.has(id))
  const restoredValue = money(restoredIds.reduce((total, id) => total + Number(arById.get(id)?.valor ?? 0), 0))
  console.log(JSON.stringify({ apply, MATCHES_AUDITED: resolved.length, ...counts, AR_RESTORED_COUNT: restoredIds.length, AR_RESTORED_VALUE: restoredValue, MISSING_SEMANTIC_RECEIVABLES: missing.length, MISSING_SEMANTIC_RECEIVABLE_IDS: missing.map((row) => row.match.olist_accounts_receivable_id), VERIFIED_MATCH_IDS: [...verified] }, null, 2))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
