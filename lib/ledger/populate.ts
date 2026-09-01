/**
 * Ledger population functions
 * Populates the canonical financial ledger from SumUp, Olist, and forecast sources
 *
 * Core principle: Every cash movement must have exactly one ledger entry
 * No double-counting, full audit trail, immutable history
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export interface LedgerEntry {
  org_id: string
  event_date: string
  competence_date?: string
  amount: number
  direction: 'entrada' | 'saida'
  nature: string
  source: 'sumup' | 'tiny' | 'olist' | 'forecast' | 'tax' | 'manual'
  source_id?: string
  source_event_id?: string
  status: 'actual' | 'scheduled' | 'projected'
  description?: string
  metadata?: Record<string, any>
}

/**
 * Populate ledger from SumUp successful payouts (actual cash in)
 */
export async function populateLedgerFromSumUpPayouts(admin: SupabaseClient, orgId: string) {
  // Load SumUp transaction events that represent payouts
  const { data: payouts, error } = await admin
    .from('sumup_transaction_events')
    .select(`
      id,
      transaction_id,
      transaction:sumup_transactions(
        id,
        timestamp_utc,
        amount
      ),
      event_type,
      status,
      event_date,
      due_date,
      amount
    `)
    .eq('org_id', orgId)
    .in('status', ['RECONCILED', 'SETTLED', 'SCHEDULED', 'PENDING'])

  if (error) {
    throw error
  }

  const entries: LedgerEntry[] = []
  for (const payout of payouts || []) {
    const transaction = payout.transaction as any
    if (!transaction) continue

    // Actual payout (entrada)
    entries.push({
      org_id: orgId,
      event_date: payout.due_date || payout.event_date || new Date().toISOString().split('T')[0],
      competence_date: transaction.timestamp_utc?.split('T')[0],
      amount: payout.amount || 0,
      direction: 'entrada',
      nature: 'SUMUP_PAYOUT_ACTUAL',
      source: 'sumup',
      source_id: transaction.id,
      source_event_id: payout.id,
      status: payout.status === 'RECONCILED' || payout.status === 'SETTLED' ? 'actual' : 'scheduled',
      description: `SumUp payout: ${payout.event_type}`,
      metadata: {
        transaction_id: payout.transaction_id,
        event_type: payout.event_type,
        event_status: payout.status,
      },
    })
  }

  return entries
}

/**
 * Populate ledger from SumUp fees (saída - cost)
 */
export async function populateLedgerFromSumUpFees(admin: SupabaseClient, orgId: string) {
  // Load SumUp transactions with fees
  const { data: transactions, error } = await admin
    .from('sumup_transactions')
    .select('id, timestamp_utc, amount, fee_amount')
    .eq('org_id', orgId)
    .eq('status', 'SUCCESSFUL')
    .gt('fee_amount', 0)

  if (error) {
    throw error
  }

  const entries: LedgerEntry[] = []
  for (const tx of transactions || []) {
    // Fee cost (saída)
    entries.push({
      org_id: orgId,
      event_date: tx.timestamp_utc?.split('T')[0] || new Date().toISOString().split('T')[0],
      competence_date: tx.timestamp_utc?.split('T')[0],
      amount: tx.fee_amount || 0,
      direction: 'saida',
      nature: 'SUMUP_FEE_COST',
      source: 'sumup',
      source_id: tx.id,
      status: 'actual',
      description: 'SumUp processing fee',
      metadata: {
        transaction_id: tx.id,
        transaction_amount: tx.amount,
      },
    })
  }

  return entries
}

/**
 * Populate ledger from Olist accounts payable.
 *
 * The payable balance is the amount still to be paid. For a paid or partially
 * paid payable, only the factual paid amount becomes actual cash; any known
 * remainder stays scheduled. Cancelled obligations do not create cash events.
 */
export async function populateLedgerFromOlistPayables(admin: SupabaseClient, orgId: string) {
  const { data: payables, error } = await admin
    .from('olist_accounts_payable')
    .select('id, olist_id, situacao, valor, saldo, valor_pago, data_emissao, data_vencimento, data_liquidacao, historico')
    .eq('org_id', orgId)

  if (error) {
    throw error
  }

  const entries: LedgerEntry[] = []
  for (const payable of payables || []) {
    const situation = String(payable.situacao || '').trim().toLowerCase()
    if (situation === 'cancelada' || situation === 'cancelado') continue

    const value = Number(payable.valor)
    const balance = Number(payable.saldo)
    const paidValue = Number(payable.valor_pago)
    const hasKnownValue = Number.isFinite(value) && value > 0
    const hasKnownBalance = Number.isFinite(balance) && balance >= 0
    const derivedPaid = hasKnownValue && hasKnownBalance ? Math.max(value - balance, 0) : null
    const factualPaid = Number.isFinite(paidValue) && paidValue >= 0 ? paidValue : derivedPaid
    const dueDate = payable.data_vencimento || payable.data_emissao || new Date().toISOString().split('T')[0]
    const metadata = {
      payable_id: payable.id,
      olist_id: payable.olist_id,
      situacao: payable.situacao,
      valor: payable.valor,
      saldo: payable.saldo,
      valor_pago: payable.valor_pago,
    }

    if (factualPaid !== null && factualPaid > 0) {
      entries.push({
        org_id: orgId,
        event_date: payable.data_liquidacao || dueDate,
        competence_date: payable.data_emissao || dueDate,
        amount: factualPaid,
        direction: 'saida',
        nature: 'OLIST_PAYABLE_ACTUAL',
        source: 'olist',
        source_id: payable.id,
        status: 'actual',
        description: payable.historico || 'Olist account payable paid',
        metadata,
      })
    }

    const remaining = hasKnownBalance ? balance : null
    if (remaining !== null && remaining > 0) {
      entries.push({
        org_id: orgId,
        event_date: dueDate,
        competence_date: payable.data_emissao || dueDate,
        amount: remaining,
        direction: 'saida',
        nature: 'OLIST_PAYABLE_SCHEDULED',
        source: 'olist',
        source_id: payable.id,
        status: 'scheduled',
        description: payable.historico || 'Olist account payable scheduled',
        metadata,
      })
    }
  }

  return entries
}

/**
 * Populate ledger from forecast projections
 */
export async function populateLedgerFromForecast(admin: SupabaseClient, orgId: string) {
  // Load forecast entries (future revenue projections)
  const { data: forecast, error } = await admin
    .from('forecast_entries')
    .select('id, ano, mes, receita, forecast_versions!inner(org_id)')
    .eq('forecast_versions.org_id', orgId)
    .gte('ano', new Date().getFullYear())

  if (error) {
    throw error
  }

  const entries: LedgerEntry[] = []
  for (const entry of forecast || []) {
    const date = new Date(entry.ano, entry.mes - 1, 1).toISOString().split('T')[0]

    entries.push({
      org_id: orgId,
      event_date: date,
      competence_date: date,
      amount: entry.receita || 0,
      direction: 'entrada',
      nature: 'FORECAST_REVENUE_PROJECTION',
      source: 'forecast',
      source_id: entry.id,
      status: 'projected',
      description: `Forecast revenue: ${entry.ano}-${String(entry.mes).padStart(2, '0')}`,
      metadata: {
        forecast_id: entry.id,
        ano: entry.ano,
        mes: entry.mes,
      },
    })
  }

  return entries
}

/**
 * Populate ledger from tax projections
 */
export async function populateLedgerFromTaxes(admin: SupabaseClient, orgId: string) {
  // Load tax configuration
  const { data: taxConfig, error: configError } = await admin
    .from('tax_configurations')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle()

  if (configError) {
    throw configError
  }

  if (!taxConfig) {
    return [] // No tax projection data yet
  }

  // For now, project Simples Nacional based on forecast
  const { data: forecast } = await admin
    .from('forecast_entries')
    .select('ano, mes, receita, forecast_versions!inner(org_id)')
    .eq('forecast_versions.org_id', orgId)

  const entries: LedgerEntry[] = []
  for (const entry of forecast || []) {
    // Monthly tax liability
    const vencimento = new Date(entry.ano, entry.mes, 20).toISOString().split('T')[0]
    const amount = (entry.receita || 0) * 0.105 // ~10.5% effective Simples rate (varies)

    entries.push({
      org_id: orgId,
      event_date: vencimento,
      competence_date: new Date(entry.ano, entry.mes - 1, 1).toISOString().split('T')[0],
      amount,
      direction: 'saida',
      nature: 'SIMPLES_NACIONAL_TAX',
      source: 'tax',
      status: 'projected',
      description: `Simples Nacional tax due: ${entry.ano}-${String(entry.mes).padStart(2, '0')}`,
      metadata: {
        mes: entry.mes,
        ano: entry.ano,
        revenue_base: entry.receita,
      },
    })
  }

  return entries
}

/**
 * Batch insert ledger entries with deduplication
 * Uses (org_id, source, source_id, event_date) as dedup key
 */
export async function insertLedgerEntriesBatch(admin: SupabaseClient, entries: LedgerEntry[]) {
  if (entries.length === 0) {
    return { inserted: 0, skipped: 0, errors: [] }
  }

  // Check for existing entries to avoid duplicates
  const sources = [...new Set(entries.map((e) => e.source))]
  const sourceIds = entries.filter((e) => e.source_id).map((e) => e.source_id)

  const { data: existing, error: existingError } = await admin
    .from('financial_ledger')
    .select('id, source, source_id, event_date')
    .eq('org_id', entries[0].org_id)
    .in('source', sources)
    .in('source_id', sourceIds.length > 0 ? sourceIds : ['NULL'])

  if (existingError && existingError.code !== 'PGRST116') {
    throw existingError
  }

  const existingSet = new Set((existing || []).map((e) => `${e.source}:${e.source_id}:${e.event_date}`))

  // Filter out duplicates
  const newEntries = entries.filter((e) => !existingSet.has(`${e.source}:${e.source_id}:${e.event_date}`))

  if (newEntries.length === 0) {
    return { inserted: 0, skipped: entries.length, errors: [] }
  }

  // Prepare for insert
  const toInsert = newEntries.map((e) => ({
    org_id: e.org_id,
    event_date: e.event_date,
    competence_date: e.competence_date || null,
    amount: e.amount,
    direction: e.direction,
    nature: e.nature,
    source: e.source,
    source_id: e.source_id || null,
    source_event_id: e.source_event_id || null,
    status: e.status,
    is_actual: e.status === 'actual',
    is_projected: e.status === 'projected',
    is_scheduled: e.status === 'scheduled',
    description: e.description || null,
    calculation_version: 'FINANCIAL_MODEL_V2_EXCEL_PARITY',
    metadata: e.metadata || null,
  }))

  // Batch insert
  const { error: insertError, data } = await admin.from('financial_ledger').insert(toInsert)

  if (insertError) {
    return {
      inserted: 0,
      skipped: entries.length - newEntries.length,
      errors: [{ code: insertError.code, message: insertError.message }],
    }
  }

  return { inserted: newEntries.length, skipped: entries.length - newEntries.length, errors: [] }
}

/**
 * Full ledger sync: Populate from all sources
 */
export async function syncLedgerFromAllSources(orgId: string) {
  const admin = createAdminSupabaseClient()

  const allEntries: LedgerEntry[] = []

  try {
    // Collect from all sources
    const sumupPayouts = await populateLedgerFromSumUpPayouts(admin, orgId)
    allEntries.push(...sumupPayouts)

    const sumupFees = await populateLedgerFromSumUpFees(admin, orgId)
    allEntries.push(...sumupFees)

    const olistPayables = await populateLedgerFromOlistPayables(admin, orgId)
    allEntries.push(...olistPayables)

    const forecast = await populateLedgerFromForecast(admin, orgId)
    allEntries.push(...forecast)

    const taxes = await populateLedgerFromTaxes(admin, orgId)
    allEntries.push(...taxes)

    // Insert all entries
    const result = await insertLedgerEntriesBatch(admin, allEntries)

    return {
      success: true,
      org_id: orgId,
      total_processed: allEntries.length,
      total_inserted: result.inserted,
      total_skipped: result.skipped,
      errors: result.errors,
    }
  } catch (error) {
    return {
      success: false,
      org_id: orgId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Calculate running balance from ledger
 */
export async function calculateLedgerBalance(admin: SupabaseClient, orgId: string, upToDate?: string) {
  const query = admin
    .from('financial_ledger')
    .select('amount, direction')
    .eq('org_id', orgId)
    .in('status', ['actual', 'scheduled']) // Exclude pure projections

  if (upToDate) {
    query.lte('event_date', upToDate)
  }

  const { data: entries, error } = await query

  if (error) {
    throw error
  }

  let balance = 0
  for (const entry of entries || []) {
    const amount = entry.direction === 'entrada' ? entry.amount : -entry.amount
    balance += amount
  }

  return balance
}
