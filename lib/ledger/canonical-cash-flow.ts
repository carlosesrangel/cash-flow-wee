import { fetchAllPages } from '@/lib/reconciliation/run'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'

type LedgerStatus = 'actual' | 'scheduled' | 'projected'

type LedgerRow = {
  id: string
  source: string
  source_id: string | null
  event_date: string
  amount: number
  direction: 'entrada' | 'saida'
  status: LedgerStatus
  nature: string
  description: string | null
}

/**
 * Canonical read model for cash-flow screens. The caller never needs to load
 * Olist/SumUp raw tables: every movement is sourced from financial_ledger and
 * mapped from its explicit status to the UI cash bucket.
 */
export async function loadCanonicalCashFlow(orgId: string): Promise<CashFlowEntry[]> {
  const admin = createAdminSupabaseClient()
  const rows = await fetchAllPages<LedgerRow>(
    (from, to) =>
      admin
        .from('financial_ledger')
        .select('id, source, source_id, event_date, amount, direction, status, nature, description')
        .eq('org_id', orgId)
        .in('status', ['actual', 'scheduled', 'projected'])
        .range(from, to),
    'Failed to load canonical financial_ledger read model'
  )

  return rows.map((row) => ({
    id: `ledger-${row.id}`,
    origin: row.nature.startsWith('OLIST_AR')
      ? 'ar'
      : row.nature.startsWith('OLIST_AP')
        ? 'ap'
        : row.source === 'manual'
          ? 'manual'
          : row.status === 'projected'
            ? 'forecast'
            : 'ledger',
    sourceId: row.source_id || row.id,
    date: row.event_date,
    amount: Number(row.amount) || 0,
    direction: row.direction,
    bucket: row.status === 'actual' ? 'realizado' : row.status === 'scheduled' ? 'contratado' : 'projetado',
    description: row.description || row.nature,
  }))
}
