/**
 * Ledger population functions
 * Populates the canonical financial ledger from SumUp, Olist, and forecast sources
 *
 * Core principle: Every cash movement must have exactly one ledger entry
 * No double-counting, full audit trail, immutable history
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { firstDayOfNextMonth } from '@/lib/forecast/cutoff'
import { calculateProjectedCmv } from '@/lib/planning/canonical'
import { calculateEffectiveSimplesTaxRate } from '@/lib/tax/simples-nacional'
import { taxPaymentDate } from '@/lib/tax/engine'

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
  const payouts = await fetchAllPages<{
    id: string
    transaction_id: string
    transaction: { id: string; timestamp_utc: string | null; amount: number | null }[] | { id: string; timestamp_utc: string | null; amount: number | null } | null
    event_type: string
    status: string
    event_date: string | null
    due_date: string | null
    amount: number | null
  }>(
    (from, to) =>
      admin
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
        .in('status', ['RECONCILED', 'SETTLED', 'PAID_OUT', 'SCHEDULED', 'PENDING'])
        .range(from, to),
    'Failed to load sumup_transaction_events for ledger'
  )

  const entries: LedgerEntry[] = []
  for (const payout of payouts || []) {
    const transaction = Array.isArray(payout.transaction) ? payout.transaction[0] : payout.transaction
    if (!transaction) continue
    const isActual = ['RECONCILED', 'SETTLED', 'PAID_OUT'].includes(payout.status)

    // Actual payout (entrada)
    entries.push({
      org_id: orgId,
      event_date: payout.due_date || payout.event_date || new Date().toISOString().split('T')[0],
      competence_date: transaction.timestamp_utc?.split('T')[0],
      amount: payout.amount || 0,
      direction: 'entrada',
      nature: isActual ? 'SUMUP_PAYOUT_ACTUAL' : 'SUMUP_PAYOUT_SCHEDULED',
      source: 'sumup',
      source_id: transaction.id,
      source_event_id: payout.id,
      status: isActual ? 'actual' : 'scheduled',
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
  const payables = await fetchAllPages<{
    id: string
    olist_id: number
    situacao: string | null
    valor: number | null
    saldo: number | null
    valor_pago: number | null
    data_emissao: string | null
    data_vencimento: string | null
    data_liquidacao: string | null
    historico: string | null
  }>(
    (from, to) =>
      admin
        .from('olist_accounts_payable')
        .select('id, olist_id, situacao, valor, saldo, valor_pago, data_emissao, data_vencimento, data_liquidacao, historico')
        .eq('org_id', orgId)
        .range(from, to),
    'Failed to load olist_accounts_payable for ledger'
  )

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
    const factualPaid = paidValue > 0 ? paidValue : derivedPaid
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
        nature: 'OLIST_AP_ACTUAL',
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
        nature: 'OLIST_AP_SCHEDULED',
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

/** Populate the ledger from Olist receivables and reconciliation results. */
export async function populateLedgerFromOlistReceivables(admin: SupabaseClient, orgId: string) {
  const [receivables, matches, contacts, orders, items] = await Promise.all([
    fetchAllPages<{
      id: string
      olist_id: number
      situacao: string | null
      valor: number | null
      saldo: number | null
      valor_pago: number | null
      data_emissao: string | null
      data_vencimento: string | null
      data_liquidacao: string | null
      historico: string | null
      numero_documento: string | null
      forma_recebimento_nome: string | null
      cliente_olist_id: number | null
    }>(
      (from, to) =>
        admin
          .from('olist_accounts_receivable')
          .select('id, olist_id, situacao, valor, saldo, valor_pago, data_emissao, data_vencimento, data_liquidacao, historico, numero_documento, forma_recebimento_nome, cliente_olist_id')
          .eq('org_id', orgId)
          .range(from, to),
      'Failed to load olist_accounts_receivable for ledger'
    ),
    fetchAllPages<{
      olist_accounts_receivable_id: string
      status: string
      sumup_transaction_event_id: string | null
    }>(
      (from, to) =>
        admin
          .from('reconciliation_matches')
          .select('olist_accounts_receivable_id, status, sumup_transaction_event_id')
          .eq('org_id', orgId)
          .range(from, to),
      'Failed to load reconciliation_matches for ledger'
    ),
    fetchAllPages<{ olist_id: number; nome: string | null }>((from, to) => admin.from('olist_contacts').select('olist_id, nome').eq('org_id', orgId).range(from, to), 'Failed to load Olist contacts for ledger metadata'),
    fetchAllPages<{ id: string; cliente_olist_id: number | null; data: string | null }>((from, to) => admin.from('olist_orders').select('id, cliente_olist_id, data').eq('org_id', orgId).range(from, to), 'Failed to load Olist orders for ledger metadata'),
    fetchAllPages<{ order_id: string; descricao_produto: string | null }>((from, to) => admin.from('olist_order_items').select('order_id, descricao_produto').eq('org_id', orgId).range(from, to), 'Failed to load Olist products for ledger metadata'),
  ])
  const nameByClientId = new Map(contacts.map((contact) => [contact.olist_id, contact.nome]))
  const productsByOrder = new Map<string, string[]>()
  for (const item of items) if (item.descricao_produto) productsByOrder.set(item.order_id, [...(productsByOrder.get(item.order_id) ?? []), item.descricao_produto])
  const orderProducts = orders.filter((order) => order.cliente_olist_id && order.data && productsByOrder.has(order.id)).map((order) => ({ clientId: order.cliente_olist_id as number, date: order.data as string, product: [...new Set(productsByOrder.get(order.id))].join(', ') }))

  const eventIds = matches.map((match) => match.sumup_transaction_event_id).filter((id): id is string => Boolean(id))
  const events = eventIds.length === 0
    ? []
    : await fetchAllPages<{ id: string; due_date: string | null; event_date: string | null }>(
        (from, to) => admin.from('sumup_transaction_events').select('id, due_date, event_date').in('id', eventIds).range(from, to),
        'Failed to load reconciled SumUp events for ledger'
      )
  const eventById = new Map(events.map((event) => [event.id, event]))
  const matchByReceivableId = new Map(matches.map((match) => [match.olist_accounts_receivable_id, match]))
  const entries: LedgerEntry[] = []

  for (const receivable of receivables) {
    const situation = String(receivable.situacao || '').trim().toLowerCase()
    if (situation === 'cancelada' || situation === 'cancelado') continue

    const value = Number(receivable.valor)
    const balance = Number(receivable.saldo)
    const paidValue = Number(receivable.valor_pago)
    const hasKnownValue = Number.isFinite(value) && value > 0
    const hasKnownBalance = Number.isFinite(balance) && balance >= 0
    const derivedPaid = hasKnownValue && hasKnownBalance ? Math.max(value - balance, 0) : null
    const match = matchByReceivableId.get(receivable.id)
    const resolved = match?.status === 'reconciliado_automaticamente' || match?.status === 'reconciliado_manualmente'
    const paymentMethod = String(receivable.forma_recebimento_nome || '').trim().toLowerCase()
    const isPix = paymentMethod.includes('pix')
    const isCash = paymentMethod.includes('dinheiro') || paymentMethod.includes('espécie') || paymentMethod.includes('especie')
    // In this integration, a resolved reconciliation is the authoritative
    // settlement signal. The Olist detail field can remain `0`/the original
    // balance because the payment is confirmed by SumUp, so a zero-valued
    // `valor_pago` must not erase the resolved cash movement.
    const factualPaid = resolved
      ? (Number.isFinite(paidValue) && paidValue > 0 ? paidValue : (derivedPaid !== null && derivedPaid > 0 ? derivedPaid : value))
      : (Number.isFinite(paidValue) && paidValue > 0 ? paidValue : derivedPaid)
    const dueDate = receivable.data_vencimento || receivable.data_emissao || new Date().toISOString().split('T')[0]
    const event = match?.sumup_transaction_event_id ? eventById.get(match.sumup_transaction_event_id) : undefined
    const closestOrder = receivable.cliente_olist_id && receivable.data_emissao
      ? orderProducts.map((order) => ({ ...order, diff: Math.abs(new Date(order.date).getTime() - new Date(receivable.data_emissao as string).getTime()) })).filter((order) => order.clientId === receivable.cliente_olist_id && order.diff <= 3 * 86400000).sort((a, b) => a.diff - b.diff)[0]
      : undefined
    const parcela = receivable.historico?.match(/parcela\s+(\d+\/\d+)/i)?.[1] ?? null
    const metadata = {
      receivable_id: receivable.id,
      olist_id: receivable.olist_id,
      situacao: receivable.situacao,
      valor: receivable.valor,
      saldo: receivable.saldo,
      valor_pago: receivable.valor_pago,
      reconciliation_status: match?.status ?? 'nao_reconciliado',
      payment_method: receivable.forma_recebimento_nome,
      forma_pagamento: receivable.forma_recebimento_nome,
      cliente: receivable.cliente_olist_id ? nameByClientId.get(receivable.cliente_olist_id) ?? null : null,
      produto: closestOrder?.product ?? null,
      parcela,
      documento: receivable.numero_documento,
    }

    // PIX and cash are factual Tiny settlements, independent from SumUp.
    // The source AR row is the only cash event for these payment methods.
    if ((isPix || isCash) && hasKnownValue) {
      entries.push({
        org_id: orgId,
        event_date: receivable.data_emissao || dueDate,
        competence_date: receivable.data_emissao || dueDate,
        amount: value,
        direction: 'entrada',
        nature: isPix ? 'TINY_PIX_ACTUAL' : 'TINY_CASH_ACTUAL',
        source: 'tiny',
        source_id: receivable.id,
        status: 'actual',
        description: isPix ? 'Recebimento PIX' : 'Recebimento em dinheiro',
        metadata,
      })
      continue
    }

    // For cards, SumUp is the financial source. The matched Tiny AR row is
    // deliberately not materialized as a second actual cash movement.
    if (resolved) {
      continue
    }

    if (factualPaid !== null && factualPaid > 0) {
      entries.push({
        org_id: orgId,
        event_date: receivable.data_liquidacao || event?.due_date || event?.event_date || dueDate,
        competence_date: receivable.data_emissao || dueDate,
        amount: factualPaid,
        direction: 'entrada',
        nature: 'OLIST_AR_ACTUAL',
        source: 'olist',
        source_id: receivable.id,
        source_event_id: match?.sumup_transaction_event_id || match?.olist_accounts_receivable_id,
        status: 'actual',
        description: receivable.historico || receivable.numero_documento || 'Olist account receivable received',
        metadata,
      })
    }

    if (hasKnownBalance && balance > 0) {
      entries.push({
        org_id: orgId,
        event_date: dueDate,
        competence_date: receivable.data_emissao || dueDate,
        amount: balance,
        direction: 'entrada',
        nature: 'OLIST_AR_SCHEDULED',
        source: 'olist',
        source_id: receivable.id,
        source_event_id: match?.sumup_transaction_event_id ? `${match.sumup_transaction_event_id}:remaining` : undefined,
        status: 'scheduled',
        description: receivable.historico || receivable.numero_documento || 'Olist account receivable scheduled',
        metadata,
      })
    }
  }

  return entries
}

/** Populate manually entered cash movements; balance adjustments remain snapshots. */
export async function populateLedgerFromManualEntries(admin: SupabaseClient, orgId: string) {
  const entries = await fetchAllPages<{
    id: string
    type: string
    amount: number
    entry_date: string
    description: string | null
  }>(
    (from, to) =>
      admin
        .from('manual_cash_entries')
        .select('id, type, amount, entry_date, description')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .in('type', ['entrada', 'saida'])
        .range(from, to),
    'Failed to load manual_cash_entries for ledger'
  )

  return entries.map((entry): LedgerEntry => ({
    org_id: orgId,
    event_date: entry.entry_date,
    competence_date: entry.entry_date,
    amount: Math.abs(Number(entry.amount) || 0),
    direction: entry.type === 'entrada' ? 'entrada' : 'saida',
    nature: 'MANUAL_ENTRY',
    source: 'manual',
    source_id: entry.id,
    status: 'actual',
    description: entry.description || 'Manual cash entry',
    metadata: { manual_entry_id: entry.id, type: entry.type },
  }))
}

/**
 * Populate ledger from forecast projections
 */
export async function populateLedgerFromForecast(admin: SupabaseClient, orgId: string) {
  const { data: plan, error } = await admin.from('monthly_sales_plan').select('id, competence_month, amount').eq('org_id', orgId).gte('competence_month', firstDayOfNextMonth()).order('competence_month')
  if (error) throw error
  const { error: supersedeError } = await admin.from('financial_ledger').update({ superseded_at: new Date().toISOString(), supersession_reason: 'forecast_projection_rebuilt' }).eq('org_id', orgId).eq('source', 'forecast').eq('status', 'projected').is('superseded_at', null)
  if (supersedeError) throw supersedeError
  const entries: LedgerEntry[] = []
  for (const entry of plan || []) {
    const date = String(entry.competence_month)
    const [ano, mes] = date.slice(0, 7).split('-').map(Number)
    const cmv = calculateProjectedCmv(Number(entry.amount) || 0, date)
    entries.push({
      org_id: orgId,
      event_date: date,
      competence_date: date,
      amount: Number(entry.amount) || 0,
      direction: 'entrada',
      nature: 'FORECAST_REVENUE_PROJECTION',
      source: 'forecast',
      source_id: entry.id,
      status: 'projected',
      description: 'Entrada projetada',
      metadata: { plan_id: entry.id, ano, mes, categoria: 'Receita projetada', source_of_truth: 'monthly_sales_plan' },
    })
    entries.push({ org_id: orgId, event_date: `${date.slice(0, 7)}-01`, competence_date: date, amount: cmv.day1, direction: 'saida', nature: 'PROJECTED_CMV', source: 'forecast', source_id: `${entry.id}:cmv:01`, status: 'projected', description: 'CMV projetado', metadata: { plan_id: entry.id, categoria: 'CMV', formula: 'receita / 3.1 * 1.1', parcela: '1/2' } })
    entries.push({ org_id: orgId, event_date: `${date.slice(0, 7)}-15`, competence_date: date, amount: cmv.day15, direction: 'saida', nature: 'PROJECTED_CMV', source: 'forecast', source_id: `${entry.id}:cmv:15`, status: 'projected', description: 'CMV projetado', metadata: { plan_id: entry.id, categoria: 'CMV', formula: 'receita / 3.1 * 1.1', parcela: '2/2' } })
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

  const { data: forecast, error: forecastError } = await admin
    .from('monthly_sales_plan')
    .select('id, competence_month, amount')
    .eq('org_id', orgId)
    .gte('competence_month', firstDayOfNextMonth())
    .order('competence_month')
  if (forecastError) throw forecastError

  const entries: LedgerEntry[] = []
  for (const entry of forecast || []) {
    const competence = String(entry.competence_month)
    const ano = Number(competence.slice(0, 4)); const mes = Number(competence.slice(5, 7))
    const amountRevenue = Number(entry.amount) || 0
    const { data: history } = await admin.from('monthly_sales_plan').select('competence_month, amount').eq('org_id', orgId).gte('competence_month', `${ano - 1}-${String(mes).padStart(2, '0')}-01`).lt('competence_month', competence).order('competence_month')
    const rbt12 = (history || []).reduce((sum: number, row: { amount: number | null }) => sum + Number(row.amount || 0), 0)
    const taxInfo = calculateEffectiveSimplesTaxRate(rbt12, ano)
    const amount = Math.round(amountRevenue * taxInfo.aliquota_efetiva * 100) / 100

    entries.push({
      org_id: orgId,
      event_date: taxPaymentDate(ano, mes),
      competence_date: competence,
      amount,
      direction: 'saida',
      nature: 'SIMPLES_NACIONAL_TAX',
      source: 'tax',
      status: 'projected',
      description: 'Imposto projetado',
      metadata: {
        mes,
        ano,
        revenue_base: amountRevenue,
        tax_accrual_type: 'TAX_ACCRUAL',
        tax_cash_payment_type: 'TAX_CASH_PAYMENT',
        tax_accrual_competence: competence,
        tax_cash_payment_date: taxPaymentDate(ano, mes),
        rbt12,
        aliquota_nominal: taxInfo.aliquota_nominal,
        parcela_deduzir: taxInfo.parcela_deduzir,
        faixa: taxInfo.faixa,
        regime_2027: 'SIMPLES_NACIONAL_PURO',
      },
    })
  }

  return entries
}

/**
 * Batch insert ledger entries with deduplication
 * Uses (org_id, source, source_id, source_event_id, event_date) as dedup key.
 * source_event_id is required for sources that legitimately have multiple
 * events with a null/shared source_id on the same date.
 */
export async function insertLedgerEntriesBatch(admin: SupabaseClient, entries: LedgerEntry[]) {
  if (entries.length === 0) {
    return { inserted: 0, skipped: 0, errors: [] }
  }

  // Check for existing entries to avoid duplicates
  const sources = [...new Set(entries.map((e) => e.source))]
  const existing = await fetchAllPages<{ id: string; source: string; source_id: string | null; source_event_id: string | null; event_date: string }>(
    (from, to) =>
      admin
        .from('financial_ledger')
        .select('id, source, source_id, source_event_id, event_date')
        .eq('org_id', entries[0].org_id)
        .in('source', sources)
        .is('superseded_at', null)
        .range(from, to),
    'Failed to load existing ledger entries for deduplication'
  )

  const ledgerKey = (entry: { source: string; source_id?: string | null; source_event_id?: string | null; event_date: string }) =>
    `${entry.source}:${entry.source_id || 'NULL'}:${entry.source_event_id || 'NULL'}:${entry.event_date}`
  const existingSet = new Set(existing.map((e) => ledgerKey(e)))

  // Filter out duplicates
  const newEntries = entries.filter((e) => {
    const key = ledgerKey(e)
    if (existingSet.has(key)) return false
    existingSet.add(key)
    return true
  })

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

  // Keep inserts bounded so a large event history does not exceed the
  // PostgREST request size limit or fail as one opaque all-or-nothing request.
  const errors: { code?: string; message: string }[] = []
  let inserted = 0
  for (let offset = 0; offset < toInsert.length; offset += 500) {
    const batch = toInsert.slice(offset, offset + 500)
    const { error: insertError } = await admin.from('financial_ledger').insert(batch)
    if (insertError) {
      errors.push({ code: insertError.code, message: insertError.message })
      continue
    }
    inserted += batch.length
  }

  return { inserted, skipped: entries.length - newEntries.length, errors }
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

    const olistReceivables = await populateLedgerFromOlistReceivables(admin, orgId)
    allEntries.push(...olistReceivables)

    const olistPayables = await populateLedgerFromOlistPayables(admin, orgId)
    allEntries.push(...olistPayables)

    const manualEntries = await populateLedgerFromManualEntries(admin, orgId)
    allEntries.push(...manualEntries)

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
