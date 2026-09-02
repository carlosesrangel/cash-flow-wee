#!/usr/bin/env node
/** Read-only production acceptance metrics for CASH_FLOW_WEE_PRODUCTION_VALIDATED_V2. */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { calculateEffectiveSimplesTaxRate } from '@/lib/tax/simples-nacional'
import { firstDayOfNextMonth } from '@/lib/forecast/cutoff'
import { taxPaymentDate } from '@/lib/tax/engine'
import { PLAN_REFERENCE_VALUES, calculateProjectedCmv, isPlanEditable } from '@/lib/planning/canonical'
import { reconcileTinyCards } from '@/lib/reconciliation/deterministic'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID

type Order = {
  id: string
  data: string | null
  data_faturamento: string | null
  valor_total_pedido: number | null
  situacao: string | number | null
  raw: Record<string, unknown> | null
}
type Receivable = {
  id: string
  olist_id: number | null
  valor: number | null
  saldo: number | null
  valor_pago: number | null
  situacao: string | null
  data_emissao: string | null
  data_vencimento: string | null
  data_liquidacao: string | null
  historico: string | null
  numero_documento: string | null
  forma_recebimento_nome: string | null
}
type SumupTransaction = {
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
  entry_mode: string | null
}
type LedgerRow = {
  id: string
  event_date: string
  competence_date: string | null
  amount: number | null
  direction: string
  nature: string
  source: string
  source_id: string | null
  source_event_id: string | null
  status: string
  metadata: Record<string, unknown> | null
  superseded_at: string | null
}
type Match = {
  id: string
  olist_accounts_receivable_id: string
  sumup_transaction_id: string | null
  sumup_transaction_event_id: string | null
  status: string
  match_reason: Record<string, unknown> | null
}

const money = (value: number) => Math.round(value * 100) / 100
const sum = (rows: Array<{ amount?: number | null; valor?: number | null }>) => money(rows.reduce((total, row) => total + Number(row.amount ?? row.valor ?? 0), 0))
const normalized = (value: unknown) => String(value ?? '').trim().toLowerCase()
const isCancelled = (row: { situacao: unknown; raw?: Record<string, unknown> | null }) => {
  const values = [row.situacao, row.raw?.situacao_nome].map(normalized)
  return values.some((value) => ['cancelado', 'cancelada', 'cancelled', 'canceled'].includes(value))
}
const isRefunded = (value: unknown) => ['refund', 'refunded', 'estornado', 'estornada'].includes(normalized(value))
const isCard = (value: unknown) => ['cartão de crédito', 'cartão de débito', 'cartao de credito', 'cartao de debito'].includes(normalized(value))
const isPix = (value: unknown) => normalized(value).includes('pix')
const isCash = (value: unknown) => ['dinheiro', 'cash', 'especie', 'espécie'].some((token) => normalized(value).includes(token))
const monthOf = (value: string | null | undefined) => value ? value.slice(0, 7) : null

async function loadRows<T>(client: ReturnType<typeof createAdminSupabaseClient>, table: string, select: string, filter: (query: any) => any): Promise<T[]> {
  return fetchAllPages<T>((from, to) => filter(client.from(table).select(select).range(from, to)), `Falha ao carregar ${table}`)
}

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const client = createAdminSupabaseClient()
  const [orders, receivables, sumup, ledger, matches, plans, refreshRuns] = await Promise.all([
    loadRows<Order>(client, 'olist_orders', 'id, data, data_faturamento, valor_total_pedido, situacao, raw', (q) => q.eq('org_id', orgId)),
    loadRows<Receivable>(client, 'olist_accounts_receivable', 'id, olist_id, valor, saldo, valor_pago, situacao, data_emissao, data_vencimento, data_liquidacao, historico, numero_documento, forma_recebimento_nome', (q) => q.eq('org_id', orgId)),
    loadRows<SumupTransaction>(client, 'sumup_transactions', 'id, transaction_id, transaction_code, amount, timestamp_utc, status, simple_status, payment_type, installments_count, refunded_amount, entry_mode', (q) => q.eq('org_id', orgId)),
    loadRows<LedgerRow>(client, 'financial_ledger', 'id, event_date, competence_date, amount, direction, nature, source, source_id, source_event_id, status, metadata, superseded_at', (q) => q.eq('org_id', orgId)),
    loadRows<Match>(client, 'reconciliation_matches', 'id, olist_accounts_receivable_id, sumup_transaction_id, sumup_transaction_event_id, status, match_reason', (q) => q.eq('org_id', orgId)),
    loadRows<{ competence_month: string; amount: number }>(client, 'monthly_sales_plan', 'competence_month, amount', (q) => q.eq('org_id', orgId).order('competence_month')),
    loadRows<{ created_at: string; olist_finished_at: string | null; sumup_finished_at: string | null; analytics_finished_at: string | null; ledger_finished_at: string | null }>(client, 'financial_refresh_runs', 'created_at, olist_finished_at, sumup_finished_at, analytics_finished_at, ledger_finished_at', (q) => q.eq('org_id', orgId).order('created_at', { ascending: false }).limit(5)),
  ])

  const activeLedger = ledger.filter((row) => !row.superseded_at)
  const validOrders = orders.filter((order) => !isCancelled(order) && Number(order.valor_total_pedido) > 0)
  const liveReceivables = receivables.filter((row) => !isCancelled(row) && !isRefunded(row.situacao) && Number(row.valor) > 0)
  const tinyPix = liveReceivables.filter((row) => isPix(row.forma_recebimento_nome))
  const tinyCash = liveReceivables.filter((row) => isCash(row.forma_recebimento_nome))
  const tinyCards = liveReceivables.filter((row) => isCard(row.forma_recebimento_nome))
  const ledgerPix = activeLedger.filter((row) => row.nature === 'TINY_PIX_ACTUAL')
  const ledgerCash = activeLedger.filter((row) => row.nature === 'TINY_CASH_ACTUAL')
  const cardTransactions = sumup.filter((row) => ['pos', 'ecom'].includes(normalized(row.payment_type)) && !normalized(row.entry_mode).includes('pix') && !['failed', 'failure', 'cancelled', 'canceled'].includes(normalized(row.status)))
  const successfulCardTransactions = cardTransactions.filter((row) => ['successful', 'success'].includes(normalized(row.status)) || ['successful', 'success'].includes(normalized(row.simple_status)))

  const matchedAr = matches.filter((match) => match.status === 'reconciliado_automaticamente' || match.status === 'reconciliado_manualmente')
  const matchedArIds = new Set(matchedAr.map((match) => match.olist_accounts_receivable_id))
  const matchedSumupIds = new Set(matchedAr.map((match) => match.sumup_transaction_id).filter((id): id is string => Boolean(id)))
  const storedReconciliation = {
    TINY_CARD_SALES: tinyCards.length,
    TINY_CARD_VALUE: sum(tinyCards),
    SUMUP_TRANSACTIONS: cardTransactions.length,
    SUMUP_VALUE: sum(cardTransactions),
    MATCHED: matchedAr.length,
    MATCHED_VALUE: sum(tinyCards.filter((row) => matchedArIds.has(row.id))),
    UNMATCHED_TINY: matches.filter((match) => match.status === 'nao_reconciliado').length,
    UNMATCHED_TINY_VALUE: sum(matches.filter((match) => match.status === 'nao_reconciliado').map((match) => receivables.find((row) => row.id === match.olist_accounts_receivable_id) ?? { amount: 0 }).map((row: any) => ({ amount: row.valor }))),
    AMBIGUOUS: matches.filter((match) => match.status === 'conflito').length,
    AMBIGUOUS_VALUE: sum(matches.filter((match) => match.status === 'conflito').map((match) => receivables.find((row) => row.id === match.olist_accounts_receivable_id) ?? { amount: 0 }).map((row: any) => ({ amount: row.valor }))),
    UNMATCHED_SUMUP: cardTransactions.filter((tx) => !matchedSumupIds.has(tx.id)).length,
    UNMATCHED_SUMUP_VALUE: sum(cardTransactions.filter((tx) => !matchedSumupIds.has(tx.id))),
    CANCELLED: receivables.filter((row) => isCancelled(row)).length,
    REFUNDED: sumup.filter((row) => Number(row.refunded_amount || 0) > 0 || isRefunded(row.status) || isRefunded(row.simple_status)).length,
    MATCH_RATE_COUNT: tinyCards.length ? matchedAr.length / tinyCards.length : 0,
    MATCH_RATE_VALUE: sum(tinyCards) ? sum(tinyCards.filter((row) => matchedArIds.has(row.id))) / sum(tinyCards) : 0,
    VALUE_VARIANCE: money(sum(tinyCards.filter((row) => matchedArIds.has(row.id))) - sum(cardTransactions.filter((row) => matchedSumupIds.has(row.id)))),
  }
  const deterministicInput = tinyCards.map((row) => ({ id: row.id, externalId: row.olist_id ? String(row.olist_id) : null, reference: row.numero_documento, orderId: null, amount: Number(row.valor), date: (row.data_emissao || row.data_vencimento || '').slice(0, 10), installments: row.numero_documento?.match(/\/(\d+)$/)?.[1] ? Number(row.numero_documento.match(/\/(\d+)$/)?.[1]) : null, paymentMethod: row.forma_recebimento_nome, status: row.situacao }))
  const deterministicSumup = successfulCardTransactions.map((row) => ({ id: row.id, externalId: row.transaction_code, reference: row.transaction_id, orderId: null, amount: Number(row.amount), date: (row.timestamp_utc || '').slice(0, 10), installments: row.installments_count }))
  const deterministic = reconcileTinyCards(deterministicInput, deterministicSumup)
  const deterministicMatched = deterministic.filter((row) => row.status === 'MATCHED')
  const deterministicTinyValue = money(deterministic.filter((row) => row.tinyId).reduce((total, row) => total + Number(row.valueTiny || 0), 0))
  const deterministicMatchedValue = money(deterministicMatched.reduce((total, row) => total + Number(row.valueTiny || 0), 0))
  const deterministicSumupValue = money(deterministic.filter((row) => row.sumupId).reduce((total, row) => total + Number(row.valueSumup || 0), 0))

  const currentMonth = new Date().toISOString().slice(0, 7)
  const nextMonth = firstDayOfNextMonth()
  const rbt12Start = `${new Date(Date.UTC(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)) - 13, 1)).toISOString().slice(0, 7)}-01`
  const rbt12End = `${currentMonth}-01`
  const billedOrders = validOrders.filter((order) => Boolean(order.data_faturamento))
  const revenueDate = (order: Order) => (order.data_faturamento || order.data || '').slice(0, 10)
  const rbt12Orders = validOrders.filter((order) => revenueDate(order) >= rbt12Start && revenueDate(order) < rbt12End)
  const rbt12 = sum(rbt12Orders.map((order) => ({ amount: order.valor_total_pedido })))
  const actualByMonth = new Map<string, number>()
  for (const order of validOrders) { const month = monthOf(revenueDate(order)); if (month) actualByMonth.set(month, money((actualByMonth.get(month) || 0) + Number(order.valor_total_pedido || 0))) }
  const taxYear2026Month = [...actualByMonth.keys()].filter((month) => month.startsWith('2026-')).sort().pop() || '2026-09'
  const taxRevenue = actualByMonth.get(taxYear2026Month) || 0
  const taxInfo = calculateEffectiveSimplesTaxRate(rbt12, 2026)
  const taxExample = { COMPETENCE: taxYear2026Month, REVENUE: taxRevenue, RBT12: rbt12, BRACKET: taxInfo.faixa, NOMINAL_RATE: taxInfo.aliquota_nominal, DEDUCTION: taxInfo.parcela_deduzir, EFFECTIVE_RATE: taxInfo.aliquota_efetiva, TAX: money(taxRevenue * taxInfo.aliquota_efetiva), PAYMENT_DATE: taxPaymentDate(Number(taxYear2026Month.slice(0, 4)), Number(taxYear2026Month.slice(5, 7))) }
  const tax2027 = calculateEffectiveSimplesTaxRate(rbt12, 2027)

  const forecastRows = activeLedger.filter((row) => row.source === 'forecast' && row.status === 'projected')
  const forecastCurrentOrPast = forecastRows.filter((row) => row.event_date < nextMonth).length
  const cmvOctober = calculateProjectedCmv(55000, '2026-10-01')
  const cmvLedger = activeLedger.filter((row) => row.nature === 'PROJECTED_CMV' && row.competence_date === '2026-10-01')
  const duplicateKeys = new Map<string, LedgerRow[]>()
  for (const row of activeLedger) {
    const key = row.source_event_id ? `event:${row.source_event_id}` : `row:${row.source}:${row.source_id}:${row.event_date}:${row.direction}:${row.amount}`
    duplicateKeys.set(key, [...(duplicateKeys.get(key) || []), row])
  }
  const sourceEventDuplicates = [...duplicateKeys.values()].filter((rows) => rows.length > 1)
  const arLedgerById = new Map<string, LedgerRow[]>()
  for (const row of activeLedger) { const id = typeof row.metadata?.receivable_id === 'string' ? row.metadata.receivable_id : null; if (id) arLedgerById.set(id, [...(arLedgerById.get(id) || []), row]) }
  const resolvedArDuplicateGroups = [...matchedArIds].map((id) => arLedgerById.get(id) || []).filter((rows) => rows.some((row) => row.source !== 'sumup'))
  const forecastActualCollision = activeLedger.filter((row) => row.source === 'forecast' && row.status === 'projected' && row.event_date < nextMonth).length
  const duplicateSemanticEvents = sourceEventDuplicates.length + resolvedArDuplicateGroups.length + forecastActualCollision

  const planMonths = plans.map((row) => String(row.competence_month).slice(0, 7))
  const expectedPlanMonths = Object.keys(PLAN_REFERENCE_VALUES).sort()
  const result = {
    ORG_ID: orgId,
    PLANNING: { TOTAL_ROWS: plans.length, UNIQUE_MONTHS: new Set(planMonths).size, DUPLICATES: planMonths.length - new Set(planMonths).size, MISSING_MONTHS: expectedPlanMonths.filter((month) => !planMonths.includes(month)).length, EDITABILITY: { '2026-09': isPlanEditable('2026-09-01', new Date('2026-09-02T12:00:00-03:00')), '2026-10': isPlanEditable('2026-10-01', new Date('2026-09-02T12:00:00-03:00')) } },
    TINY_PIX: { SALES_COUNT: tinyPix.length, VALUE: sum(tinyPix) },
    TINY_CASH: { SALES_COUNT: tinyCash.length, VALUE: sum(tinyCash) },
    LEDGER_PIX: { COUNT: ledgerPix.length, VALUE: sum(ledgerPix) },
    LEDGER_CASH: { COUNT: ledgerCash.length, VALUE: sum(ledgerCash) },
    TINY_SUMUP_RECONCILIATION: { STORED: storedReconciliation, DETERMINISTIC: { MATCHED: deterministicMatched.length, MATCHED_VALUE: deterministicMatchedValue, UNMATCHED_TINY: deterministic.filter((row) => row.status === 'UNMATCHED_TINY').length, UNMATCHED_SUMUP: deterministic.filter((row) => row.status === 'UNMATCHED_SUMUP').length, AMBIGUOUS: deterministic.filter((row) => row.status === 'AMBIGUOUS').length, MATCH_RATE_COUNT: deterministicTinyValue ? deterministicMatched.length / deterministicInput.length : 0, MATCH_RATE_VALUE: deterministicTinyValue ? deterministicMatchedValue / deterministicTinyValue : 0, VALUE_VARIANCE: money(deterministicTinyValue - deterministicSumupValue) } },
    RBT12: { PERIOD: `${rbt12Start.slice(0, 7)}..${rbt12End.slice(0, 7)} (exclusive)`, MONTH_COUNT: new Set(rbt12Orders.map((order) => monthOf(revenueDate(order)))).size, GROSS_REVENUE: rbt12, SOURCE_COVERAGE: { valid_orders: validOrders.length, with_billing_date: billedOrders.length, billing_date_coverage: validOrders.length ? billedOrders.length / validOrders.length : 0 } },
    TAX_2026_EXAMPLE: taxExample,
    TAX_2027_BOUNDARY: { DEC_2026_PAYMENT_DATE: taxPaymentDate(2026, 12), JAN_2027_PAYMENT_DATE: taxPaymentDate(2027, 1), PURE_SIMPLES_RATE_SAME_AS_2026: tax2027.aliquota_efetiva === taxInfo.aliquota_efetiva, REGIME: 'SIMPLES_NACIONAL_PURO', BASE: 'data_faturamento; recebimento SumUp não é base fiscal' },
    FORECAST: { FIRST_ALLOWED_CASH_DATE: nextMonth, FORECAST_CURRENT_MONTH: forecastCurrentOrPast, FORECAST_FUTURE_ROWS: forecastRows.filter((row) => row.event_date >= nextMonth).length },
    CMV_OCTOBER_2026: { EXPECTED: cmvOctober, LEDGER_ROWS: cmvLedger.map((row) => ({ date: row.event_date, amount: row.amount, nature: row.nature })) },
    SALES_TARGET_2026_09: { TARGET: PLAN_REFERENCE_VALUES['2026-09'], REALIZED_SALES: actualByMonth.get('2026-09') || 0, TARGET_GAP: money((actualByMonth.get('2026-09') || 0) - PLAN_REFERENCE_VALUES['2026-09']), ACHIEVEMENT_PERCENT: PLAN_REFERENCE_VALUES['2026-09'] ? money(((actualByMonth.get('2026-09') || 0) / PLAN_REFERENCE_VALUES['2026-09']) * 100) : 0 },
    DUPLICATE_SEMANTIC_EVENTS: duplicateSemanticEvents,
    REFRESH_RUNS: refreshRuns,
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
