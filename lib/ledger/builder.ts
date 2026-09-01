/**
 * Financial Model V2: Unified Financial Ledger Builder
 *
 * Canonical immutable ledger for all cash flow movements
 * Every entry is auditable and traceable
 *
 * Nature categories:
 * - OPENING_BALANCE: initial balance
 * - SUMUP_PAYOUT_ACTUAL: SumUp payout received
 * - SUMUP_PAYOUT_SCHEDULED: SumUp payout scheduled/pending
 * - PROJECTED_SALES_RECEIPT: projected receipt from future sale
 * - ACCOUNTS_RECEIVABLE: Olist A/R or other receivable
 * - ACCOUNTS_PAYABLE: Tiny payable or other obligation
 * - PROJECTED_SIMPLES_TAX: tax liability (competence date)
 * - MANUAL_INFLOW: manual income entry
 * - MANUAL_OUTFLOW: manual expense entry
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>
type LedgerRow = any

export type LedgerEntryInput = {
  org_id: string
  event_date: Date
  competence_date?: Date
  amount: number
  direction: 'entrada' | 'saida'
  nature:
    | 'OPENING_BALANCE'
    | 'SUMUP_PAYOUT_ACTUAL'
    | 'SUMUP_PAYOUT_SCHEDULED'
    | 'PROJECTED_SALES_RECEIPT'
    | 'ACCOUNTS_RECEIVABLE'
    | 'ACCOUNTS_PAYABLE'
    | 'PROJECTED_SIMPLES_TAX'
    | 'MANUAL_INFLOW'
    | 'MANUAL_OUTFLOW'
  source: string
  source_id?: string
  source_event_id?: string
  status: 'actual' | 'scheduled' | 'projected'
  description?: string
  metadata?: Record<string, any>
  created_by?: string
}

export type LedgerBalance = {
  data: Date
  saldo_inicial: number
  entradas: number
  saidas: number
  saldo_final: number
  compositions: {
    entradas_por_nature: Record<string, number>
    saidas_por_nature: Record<string, number>
  }
}

/**
 * Create a ledger entry
 */
export async function createLedgerEntry(
  admin: AdminClient,
  input: LedgerEntryInput
): Promise<LedgerRow> {
  const { data, error } = await admin
    .from('financial_ledger')
    .insert({
      org_id: input.org_id,
      event_date: input.event_date,
      competence_date: input.competence_date || null,
      amount: input.amount,
      direction: input.direction,
      nature: input.nature,
      source: input.source,
      source_id: input.source_id || null,
      source_event_id: input.source_event_id || null,
      status: input.status,
      is_actual: input.status === 'actual',
      is_projected: input.status === 'projected',
      is_scheduled: input.status === 'scheduled',
      description: input.description || null,
      metadata: input.metadata || null,
      created_by: input.created_by || null,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create ledger entry: ${error.message}`)
  }

  return data
}

/**
 * Batch create ledger entries
 */
export async function createLedgerEntries(
  admin: AdminClient,
  inputs: LedgerEntryInput[]
): Promise<LedgerRow[]> {
  const entries = inputs.map((input) => ({
    org_id: input.org_id,
    event_date: input.event_date,
    competence_date: input.competence_date || null,
    amount: input.amount,
    direction: input.direction,
    nature: input.nature,
    source: input.source,
    source_id: input.source_id || null,
    source_event_id: input.source_event_id || null,
    status: input.status,
    is_actual: input.status === 'actual',
    is_projected: input.status === 'projected',
    is_scheduled: input.status === 'scheduled',
    description: input.description || null,
    metadata: input.metadata || null,
    created_by: input.created_by || null,
  }))

  const { data, error } = await admin.from('financial_ledger').insert(entries).select()

  if (error) {
    throw new Error(`Failed to create ledger entries: ${error.message}`)
  }

  return data || []
}

/**
 * Get ledger entries for a date range
 */
export async function getLedgerEntries(
  admin: AdminClient,
  orgId: string,
  startDate: Date,
  endDate: Date,
  statusFilter?: 'actual' | 'scheduled' | 'projected'
): Promise<LedgerRow[]> {
  let query = admin
    .from('financial_ledger')
    .select('*')
    .eq('org_id', orgId)
    .gte('event_date', startDate.toISOString().split('T')[0])
    .lte('event_date', endDate.toISOString().split('T')[0])
    .order('event_date', { ascending: true })

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to load ledger entries: ${error.message}`)
  }

  return data || []
}

/**
 * Calculate cumulative balance from ledger for a given date
 */
export async function calculateCumulativeBalance(
  admin: AdminClient,
  orgId: string,
  upToDate: Date,
  openingBalance: number = 0
): Promise<number> {
  const { data, error } = await admin
    .from('financial_ledger')
    .select('direction, amount')
    .eq('org_id', orgId)
    .lte('event_date', upToDate.toISOString().split('T')[0])

  if (error) {
    throw new Error(`Failed to calculate balance: ${error.message}`)
  }

  let saldo = openingBalance
  for (const entry of data || []) {
    if (entry.direction === 'entrada') {
      saldo += entry.amount
    } else {
      saldo -= entry.amount
    }
  }

  return Math.round(saldo * 100) / 100 // 2 decimals
}

/**
 * Get balance for a specific date with composition
 */
export async function getBalanceComposition(
  admin: AdminClient,
  orgId: string,
  date: Date
): Promise<LedgerBalance | null> {
  const entries = await getLedgerEntries(admin, orgId, new Date('2000-01-01'), date)

  const compositions = {
    entradas_por_nature: {} as Record<string, number>,
    saidas_por_nature: {} as Record<string, number>,
  }

  let entradas = 0
  let saidas = 0

  for (const entry of entries) {
    if (entry.direction === 'entrada') {
      entradas += entry.amount
      compositions.entradas_por_nature[entry.nature] =
        (compositions.entradas_por_nature[entry.nature] || 0) + entry.amount
    } else {
      saidas += entry.amount
      compositions.saidas_por_nature[entry.nature] =
        (compositions.saidas_por_nature[entry.nature] || 0) + entry.amount
    }
  }

  return {
    data: date,
    saldo_inicial: 0, // Would need to fetch actual opening balance
    entradas,
    saidas,
    saldo_final: entradas - saidas,
    compositions,
  }
}
