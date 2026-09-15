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
  metadata: Record<string, unknown> | null
}

/**
 * Canonical read model for cash-flow screens. The caller never needs to load
 * Olist/SumUp raw tables: every movement is sourced from financial_ledger and
 * mapped from its explicit status to the UI cash bucket.
 */
export async function loadCanonicalCashFlow(orgId: string): Promise<CashFlowEntry[]> {
  const admin = createAdminSupabaseClient()
  const dateOnly = (value: string) => String(value).slice(0, 10)
  const rows = await fetchAllPages<LedgerRow>(
    (from, to) =>
      admin
        .from('financial_ledger')
        .select('id, source, source_id, event_date, amount, direction, status, nature, description, metadata')
        .eq('org_id', orgId)
        .in('status', ['actual', 'scheduled', 'projected'])
        .is('superseded_at', null)
        .order('event_date')
        .order('id')
        .range(from, to),
    'Failed to load canonical financial_ledger read model'
  )

  const manual = await fetchAllPages<{ id: string; entry_date: string; amount: number; type: 'entrada' | 'saida'; description: string | null }>((a, b) => admin.from('manual_cash_entries').select('id, entry_date, amount, type, description').eq('org_id', orgId).is('deleted_at', null).in('type', ['entrada', 'saida']).order('id').range(a, b), 'Failed to load live manual entries')
  const mapped: CashFlowEntry[] = rows.filter(row => row.source !== 'manual').map((row) => ({
    id: `ledger-${row.id}`,
    nature: row.nature,
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
    date: dateOnly(row.event_date),
    amount: Number(row.amount) || 0,
    direction: row.direction,
    bucket: row.status === 'actual' ? 'realizado' : row.status === 'scheduled' ? 'contratado' : 'projetado',
    description: row.description || row.nature,
    customer: typeof row.metadata?.cliente === 'string' ? row.metadata.cliente : null,
    product: typeof row.metadata?.produto === 'string' ? row.metadata.produto : null,
    installment: typeof row.metadata?.parcela === 'string' ? row.metadata.parcela : null,
    paymentMethod: typeof row.metadata?.forma_pagamento === 'string' ? row.metadata.forma_pagamento : typeof row.metadata?.payment_method === 'string' ? row.metadata.payment_method : null,
    supplier: typeof row.metadata?.fornecedor === 'string' ? row.metadata.fornecedor : null,
    category: typeof row.metadata?.categoria === 'string' ? row.metadata.categoria : null,
    document: typeof row.metadata?.documento === 'string' ? row.metadata.documento : null,
  }))
  return [...mapped, ...manual.map(row => ({ id: `manual-${row.id}`, nature: 'MANUAL_ENTRY', origin: 'manual' as const, sourceId: row.id, date: dateOnly(row.entry_date), amount: Number(row.amount), direction: row.type, bucket: 'realizado' as const, description: row.description }))]
}
