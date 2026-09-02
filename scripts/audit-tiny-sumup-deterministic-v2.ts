#!/usr/bin/env node
/**
 * Read-only deterministic audit of the Tiny/SumUp comparable universe.
 * It deliberately reports candidate evidence separately from a verified match.
 */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { isVerifiedReconciliation } from '@/lib/reconciliation/verification'
import { buildSignedBridge } from '@/lib/reconciliation/signed-bridge'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID
const money = (value: number) => Math.round(value * 100) / 100
const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()
const dateOnly = (value: string | null | undefined) => value?.slice(0, 10) ?? null
const cardTiny = (value: string | null) => ['cartão de crédito', 'cartão de débito', 'cartao de credito', 'cartao de debito'].includes(norm(value))
const cardSumup = (value: string | null) => ['pos', 'ecom'].includes(norm(value))
const successful = (row: Tx) => ['successful', 'success', 'reconciled', 'settled', 'paid_out', 'scheduled', 'pending'].includes(norm(row.status)) || ['successful', 'success', 'reconciled', 'settled', 'paid_out', 'scheduled', 'pending'].includes(norm(row.simple_status))
const cancelled = (value: unknown) => ['cancelled', 'canceled', 'cancelado', 'cancelada'].includes(norm(value))
const sum = (values: number[]) => money(values.reduce((total, value) => total + value, 0))
const month = (value: string | null) => value?.slice(0, 7) ?? 'UNKNOWN'
const daysBetween = (left: string | null, right: string | null) => {
  if (!left || !right) return null
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86400000)
}

type Ar = { id: string; olist_id: number | null; valor: number | null; data_emissao: string | null; data_vencimento: string | null; numero_documento: string | null; forma_recebimento_nome: string | null; situacao: string | null; raw: Record<string, any> | null }
type Tx = { id: string; transaction_code: string | null; transaction_id: string | null; amount: number | null; timestamp_utc: string | null; status: string | null; simple_status: string | null; payment_type: string | null; installments_count: number | null; fee_amount: number | null; payouts_total: number | null; payouts_received: number | null; payout_date: string | null; refunded_amount: number | null; raw: Record<string, any> | null }
type Event = { id: string; transaction_id: string; sumup_event_id: string | null; event_type: string; status: string; amount: number | null; event_date: string | null; due_date: string | null; event_timestamp: string | null; installment_number: number | null; raw: Record<string, any> | null }
type Match = { id: string; olist_accounts_receivable_id: string; sumup_transaction_id: string | null; status: string; match_reason: Record<string, unknown> | null }
type TinySale = { key: string; arIds: string[]; value: number; saleDate: string | null; dueDates: string[]; installmentCount: number | null; references: string[]; identifiers: string[] }
type AuditRow = {
  category: string
  status: 'CANDIDATE_ONLY' | 'DETERMINISTIC_CAUSE' | 'AMBIGUOUS' | 'UNRESOLVED'
  sumupId: string
  sumupReference: string | null
  sumupDate: string | null
  sumupValue: number
  tinyIds: string[]
  tinyReferences: string[]
  tinyDate: string | null
  tinyValue: number | null
  difference: number | null
  rule: string
  evidence: Record<string, unknown>
}

async function load<T>(client: ReturnType<typeof createAdminSupabaseClient>, table: string, select: string, filter: (query: any) => any) {
  return fetchAllPages<T>((from, to) => filter(client.from(table).select(select).range(from, to)), `Falha ao carregar ${table}`)
}

function suffix(reference: string | null) {
  const match = reference?.match(/\/(\d+)$/)
  return match ? Number(match[1]) : null
}

function rawIdentifiers(row: Tx) {
  const raw = row.raw ?? {}
  return [row.transaction_code, row.transaction_id, raw.client_transaction_id, raw.internal_id == null ? null : String(raw.internal_id)].map(norm).filter(Boolean)
}

function createTinySales(rows: Ar[]) {
  const grouped = new Map<string, TinySale>()
  for (const row of rows.filter((candidate) => cardTiny(candidate.forma_recebimento_nome) && Number(candidate.valor ?? 0) > 0)) {
    const reference = row.numero_documento?.trim() || row.id
    const key = reference.replace(/\/\d+$/, '')
    const item = grouped.get(key) ?? { key, arIds: [], value: 0, saleDate: null, dueDates: [], installmentCount: null, references: [], identifiers: [] }
    item.arIds.push(row.id)
    item.value = money(item.value + Number(row.valor ?? 0))
    item.saleDate = !item.saleDate || (dateOnly(row.data_emissao) ?? '') < item.saleDate ? dateOnly(row.data_emissao) : item.saleDate
    if (dateOnly(row.data_vencimento)) item.dueDates.push(dateOnly(row.data_vencimento)!)
    item.installmentCount = Math.max(item.installmentCount ?? 0, suffix(reference) ?? 0) || null
    item.references.push(reference)
    item.identifiers.push(norm(reference), row.olist_id == null ? '' : norm(row.olist_id))
    grouped.set(key, item)
  }
  return [...grouped.values()].map((item) => ({ ...item, dueDates: [...new Set(item.dueDates)].sort(), identifiers: [...new Set(item.identifiers.filter(Boolean))] })).sort((a, b) => (a.saleDate ?? '').localeCompare(b.saleDate ?? ''))
}

function eventDates(events: Event[], txId: string) {
  return events.filter((event) => event.transaction_id === txId && norm(event.event_type) === 'payout' && Number(event.amount ?? 0) > 0).map((event) => ({ date: event.event_date, dueDate: event.due_date, amount: Number(event.amount), installment: event.installment_number }))
}

function classify(tx: Tx, events: Event[], tiny: TinySale[], verifiedTx: Set<string>, byId: Map<string, TinySale[]>, duplicateCodes: Map<string, number>): AuditRow | null {
  if (verifiedTx.has(tx.id)) return null
  const value = Number(tx.amount ?? 0)
  const date = dateOnly(tx.timestamp_utc)
  const idCandidates = [...new Set(rawIdentifiers(tx).flatMap((key) => (byId.get(key) ?? []).map((sale) => sale.key)))]
  const amountCandidates = tiny.filter((sale) => Math.abs(sale.value - value) <= 0.01)
  const dateCandidates = amountCandidates.filter((sale) => sale.saleDate === date)
  const payout = eventDates(events, tx.id)
  const payoutTotal = sum(payout.map((event) => event.amount))
  const payoutCandidates = payoutTotal > 0 ? tiny.filter((sale) => Math.abs(sale.value - payoutTotal) <= 0.01) : []
  const make = (category: string, status: AuditRow['status'], sale: TinySale | undefined, rule: string, evidence: Record<string, unknown>): AuditRow => ({ category, status, sumupId: tx.id, sumupReference: tx.transaction_code, sumupDate: date, sumupValue: money(value), tinyIds: sale?.arIds ?? [], tinyReferences: sale?.references ?? [], tinyDate: sale?.saleDate ?? null, tinyValue: sale?.value ?? null, difference: sale ? money(value - sale.value) : null, rule, evidence })
  if (Number(tx.refunded_amount ?? 0) > 0) return make('REFUND', 'DETERMINISTIC_CAUSE', undefined, 'refunded_amount > 0', { refunded_amount: tx.refunded_amount })
  if (cancelled(tx.status) || cancelled(tx.simple_status)) return make('CANCELLED', 'DETERMINISTIC_CAUSE', undefined, 'SumUp status is cancelled', { status: tx.status, simple_status: tx.simple_status })
  if (duplicateCodes.size > 0) return make('DUPLICATE_TRANSACTION', 'DETERMINISTIC_CAUSE', undefined, 'transaction identifier repeats in the comparable universe', { duplicate_identifiers: [...duplicateCodes.entries()].filter(([, count]) => count > 1).map(([key, count]) => ({ key: key.slice(0, 6) + '…', count })) })
  if (idCandidates.length > 1) return make('MULTIPLE_TINY_ORDERS_PER_SUMUP', 'AMBIGUOUS', undefined, 'shared identifier resolves to multiple Tiny sales', { candidate_sales: idCandidates })
  if (idCandidates.length === 1) {
    const sale = tiny.find((candidate) => candidate.key === idCandidates[0])
    return make('REPRESENTATION_DIFFERENCE', 'CANDIDATE_ONLY', sale, 'shared identifier points to a Tiny sale but the stored link was not verified in the strict audit', { identifier_evidence: 'shared identifier; no new match is created', candidate_count: 1 })
  }
  if (dateCandidates.length > 1) return make('MULTIPLE_TINY_ORDERS_PER_SUMUP', 'AMBIGUOUS', undefined, 'same amount and sale date produce multiple Tiny candidates', { candidate_sales: dateCandidates.map((sale) => sale.key) })
  if (dateCandidates.length === 1) {
    const sale = dateCandidates[0]
    if (sale.installmentCount != null && tx.installments_count != null && sale.installmentCount !== tx.installments_count) return make('INSTALLMENT_GRANULARITY', 'DETERMINISTIC_CAUSE', sale, 'same amount and sale date, but installment count differs', { tiny_installments: sale.installmentCount, sumup_installments: tx.installments_count })
    return make('REPRESENTATION_DIFFERENCE', 'CANDIDATE_ONLY', sale, 'unique amount/date candidate without shared identifier; not promoted to verified match', { tiny_installments: sale.installmentCount, sumup_installments: tx.installments_count })
  }
  if (amountCandidates.length === 1) {
    const sale = amountCandidates[0]
    const payoutDateMatches = payout.some((event) => sale.dueDates.includes(event.date ?? '') || sale.dueDates.includes(event.dueDate ?? ''))
    return make(payoutDateMatches ? 'INSTALLMENT_DATE_SHIFT' : 'SALE_DATE_VS_PAYMENT_DATE_SHIFT', 'DETERMINISTIC_CAUSE', sale, payoutDateMatches ? 'gross sale equals Tiny and SumUp payout date aligns to Tiny installment due date' : 'gross sale equals Tiny, but transaction date differs from Tiny sale date', { date_delta_days: daysBetween(sale.saleDate, date), payout_dates: payout.map((event) => event.date), due_dates: sale.dueDates, payout_total: payoutTotal })
  }
  if (payoutCandidates.length === 1 && Math.abs(value - payoutTotal) > 0.01) return make('FEE_OR_GROSS_NET_EFFECT', 'DETERMINISTIC_CAUSE', payoutCandidates[0], 'SumUp payout net equals Tiny gross sale while transaction gross differs', { transaction_gross: value, payout_net: payoutTotal, fee_delta: money(value - payoutTotal) })
  if (amountCandidates.length > 1) return make('MULTIPLE_TINY_ORDERS_PER_SUMUP', 'AMBIGUOUS', undefined, 'same transaction amount maps to multiple Tiny sales', { candidate_sales: amountCandidates.map((sale) => sale.key) })
  return make('TRANSACTION_NOT_FROM_TINY_UNIVERSE', 'DETERMINISTIC_CAUSE', undefined, 'no Tiny comparable sale has the same normalized gross amount', { payout_total: payoutTotal, amount_candidate_count: 0 })
}

function wasLegacyOther(tx: Tx, events: Event[], tiny: TinySale[], byId: Map<string, TinySale[]>) {
  const value = Number(tx.amount ?? 0)
  const date = dateOnly(tx.timestamp_utc)
  const idCandidates = [...new Set(rawIdentifiers(tx).flatMap((key) => (byId.get(key) ?? []).map((sale) => sale.key)))]
  const amountCandidates = tiny.filter((sale) => Math.abs(sale.value - value) < 0.01)
  const dateCandidates = amountCandidates.filter((sale) => sale.saleDate === date)
  const payoutTotal = sum(eventDates(events, tx.id).map((event) => event.amount))
  const netCandidates = payoutTotal > 0 ? tiny.filter((sale) => Math.abs(sale.value - payoutTotal) < 0.01) : []
  if (Number(tx.refunded_amount ?? 0) > 0 || idCandidates.length > 0 || (netCandidates.length === 1 && Math.abs(value - payoutTotal) > 0.01) || dateCandidates.length > 1) return false
  if (dateCandidates.length === 1 && dateCandidates[0].installmentCount != null && tx.installments_count !== dateCandidates[0].installmentCount) return false
  if (amountCandidates.length === 1 && dateCandidates.length === 0) return false
  if (amountCandidates.length === 0) return false
  return true
}

function bridge(tiny: TinySale[], sumup: Tx[], rows: AuditRow[], verified: Array<{ tiny: TinySale; tx: Tx }>) {
  const byMonth = new Map<string, Record<string, number>>()
  const add = (key: string, category: string, value: number) => {
    const item = byMonth.get(key) ?? {}
    item[category] = money((item[category] ?? 0) + value)
    byMonth.set(key, item)
  }
  for (const sale of tiny) add(month(sale.saleDate), 'TINY_COMPARABLE', sale.value)
  for (const row of rows) add(month(row.sumupDate), row.category, row.sumupValue)
  for (const sale of tiny.filter((candidate) => !verified.some((pair) => pair.tiny.key === candidate.key))) add(month(sale.saleDate), 'TINY_UNMATCHED_OFFSET', -sale.value)
  for (const pair of verified) {
    add(month(pair.tiny.saleDate), 'VERIFIED_MATCH_DATE_ALIGNMENT', -pair.tiny.value)
    add(month(dateOnly(pair.tx.timestamp_utc)), 'VERIFIED_MATCH_DATE_ALIGNMENT', pair.tx.amount ?? 0)
  }
  const months = [...new Set([...byMonth.keys(), ...sumup.map((tx) => month(dateOnly(tx.timestamp_utc)))])].filter((key) => key !== 'UNKNOWN').sort()
  const monthly = months.map((key) => {
    const item = byMonth.get(key) ?? {}
    const sumupValue = money(sumup.filter((tx) => month(dateOnly(tx.timestamp_utc)) === key).reduce((total, tx) => total + Number(tx.amount ?? 0), 0))
    const signedTotal = money(Object.values(item).reduce((total, value) => total + value, 0))
    return { MONTH: key, ...item, SIGNED_TOTAL: signedTotal, ACTUAL_SUMUP: sumupValue, CHECK: money(signedTotal - sumupValue) }
  })
  const actualSumup = money(sumup.reduce((total, tx) => total + Number(tx.amount ?? 0), 0))
  const signed = buildSignedBridge({
    tinyComparableValue: tiny.reduce((value, sale) => value + sale.value, 0),
    actualSumupValue: actualSumup,
    unmatchedSumupByCategory: [...new Set(rows.map((row) => row.category))].sort().map((category) => ({
      category,
      value: rows.filter((row) => row.category === category).reduce((value, row) => value + row.sumupValue, 0),
      evidence: 'SumUp transaction-side cause bucket; candidate-only rows remain unverified',
    })),
    unmatchedTinyValue: tiny.filter((sale) => !verified.some((pair) => pair.tiny.key === sale.key)).reduce((value, sale) => value + sale.value, 0),
  })
  return { global: { rows: signed.lines, SIGNED_TOTAL: signed.signedTotal, ACTUAL_SUMUP: signed.actualSumup, CHECK: signed.check, PASSES_CENT_TOLERANCE: signed.passesCentTolerance }, monthly }
}

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const admin = createAdminSupabaseClient()
  const [ars, txs, events, matches] = await Promise.all([
    load<Ar>(admin, 'olist_accounts_receivable', 'id,olist_id,valor,data_emissao,data_vencimento,numero_documento,forma_recebimento_nome,situacao,raw', (q) => q.eq('org_id', orgId)),
    load<Tx>(admin, 'sumup_transactions', 'id,transaction_code,transaction_id,amount,timestamp_utc,status,simple_status,payment_type,installments_count,fee_amount,payouts_total,payouts_received,payout_date,refunded_amount,raw', (q) => q.eq('org_id', orgId)),
    load<Event>(admin, 'sumup_transaction_events', 'id,transaction_id,sumup_event_id,event_type,status,amount,event_date,due_date,event_timestamp,installment_number,raw', (q) => q.eq('org_id', orgId)),
    load<Match>(admin, 'reconciliation_matches', 'id,olist_accounts_receivable_id,sumup_transaction_id,status,match_reason', (q) => q.eq('org_id', orgId)),
  ])
  const tinyAll = createTinySales(ars)
  const datesTiny = tinyAll.map((sale) => sale.saleDate).filter((date): date is string => Boolean(date)).sort()
  const sumupAll = txs.filter((row) => cardSumup(row.payment_type) && successful(row) && Number(row.amount ?? 0) > 0 && row.timestamp_utc)
  const datesSumup = sumupAll.map((row) => dateOnly(row.timestamp_utc)).filter((date): date is string => Boolean(date)).sort()
  const start = datesTiny[0] > datesSumup[0] ? datesTiny[0] : datesSumup[0]
  const end = datesTiny.at(-1)! < datesSumup.at(-1)! ? datesTiny.at(-1)! : datesSumup.at(-1)!
  const tiny = tinyAll.filter((sale) => Boolean(sale.saleDate && sale.saleDate >= start && sale.saleDate <= end))
  const sumup = sumupAll.filter((tx) => { const date = dateOnly(tx.timestamp_utc); return Boolean(date && date >= start && date <= end) })
  const arToSale = new Map<string, TinySale>()
  for (const sale of tiny) for (const id of sale.arIds) arToSale.set(id, sale)
  const verifiedPairs = matches.filter((match) => isVerifiedReconciliation(match) && match.sumup_transaction_id).map((match) => ({ tiny: arToSale.get(match.olist_accounts_receivable_id), tx: sumup.find((candidate) => candidate.id === match.sumup_transaction_id) })).filter((pair): pair is { tiny: TinySale; tx: Tx } => Boolean(pair.tiny && pair.tx))
  const verifiedTx = new Set(verifiedPairs.map((pair) => pair.tx.id))
  const identifierToSales = new Map<string, TinySale[]>()
  for (const sale of tiny) for (const identifier of sale.identifiers) identifierToSales.set(identifier, [...(identifierToSales.get(identifier) ?? []), sale])
  const duplicateIdentifiers = new Map<string, number>()
  for (const tx of sumup) for (const identifier of rawIdentifiers(tx)) duplicateIdentifiers.set(identifier, (duplicateIdentifiers.get(identifier) ?? 0) + 1)
  const rows = sumup.map((tx) => classify(tx, events, tiny, verifiedTx, identifierToSales, new Map([...duplicateIdentifiers].filter(([, count]) => count > 1)))).filter((row): row is AuditRow => Boolean(row))
  const legacyOtherTransactions = sumup.filter((tx) => !verifiedTx.has(tx.id) && wasLegacyOther(tx, events, tiny, identifierToSales))
  const legacyOtherIds = new Set(legacyOtherTransactions.map((tx) => tx.id))
  const legacyOtherRows = rows.filter((row) => legacyOtherIds.has(row.sumupId))
  const counts = Object.fromEntries(['VERIFIED_EXACT', 'VERIFIED_COMPOSITE', 'LEGACY_UNVERIFIED', 'AMBIGUOUS', 'INVALID'].map((key) => [key, matches.filter((match) => (match.match_reason as any)?.v2_classification === key).length]))
  const categoryTotals = Object.fromEntries([...new Set(rows.map((row) => row.category))].sort().map((category) => { const matches = rows.filter((row) => row.category === category); return [category, { count: matches.length, value: sum(matches.map((row) => row.sumupValue)), statuses: Object.fromEntries([...new Set(matches.map((row) => row.status))].map((status) => [status, matches.filter((row) => row.status === status).length])) }] }))
  const classifiedButNotDecomposed = sum(rows.filter((row) => row.category === 'UNRESOLVED').map((row) => row.sumupValue))
  const explained = sum(rows.filter((row) => row.category !== 'UNRESOLVED').map((row) => row.sumupValue))
  const actualSumup = sum(sumup.map((row) => Number(row.amount ?? 0)))
  const verifiedValue = sum(verifiedPairs.map((pair) => Number(pair.tx.amount ?? 0)))
  const actualTiny = sum(tiny.map((row) => row.value))
  const bridgeReport = bridge(tiny, sumup, rows, verifiedPairs)
  const topMonths = ['2026-06', '2026-08', '2026-04', '2025-07', '2025-06', '2025-03', '2026-03'].map((key) => ({ MONTH: key, TRANSACTIONS: rows.filter((row) => month(row.sumupDate) === key).sort((a, b) => b.sumupValue - a.sumupValue).map((row) => ({ category: row.category, status: row.status, sumup_reference: row.sumupReference, sumup_date: row.sumupDate, sumup_value: row.sumupValue, tiny_references: row.tinyReferences, tiny_date: row.tinyDate, tiny_value: row.tinyValue, difference: row.difference, rule: row.rule, evidence: row.evidence })) }))
  const unresolvedResidual = money(actualSumup - (explained + classifiedButNotDecomposed + verifiedValue))
  const otherDecomposition = Object.fromEntries([...new Set(legacyOtherRows.map((row) => row.category))].sort().map((category) => { const items = legacyOtherRows.filter((row) => row.category === category); return [category, { count: items.length, value: sum(items.map((row) => row.sumupValue)) }] }))
  console.log(JSON.stringify({
    COMPARABLE_START_DATE: start, COMPARABLE_END_DATE: end,
    TINY_COMPARABLE_COUNT: tiny.length, TINY_COMPARABLE_VALUE: actualTiny,
    SUMUP_COMPARABLE_COUNT: sumup.length, SUMUP_COMPARABLE_VALUE: actualSumup,
    INITIAL_VALUE_GAP: money(actualSumup - actualTiny),
    CATEGORY_TOTALS: categoryTotals,
    LEGACY_OTHER_CLASSIFIED_CAUSES: { count: legacyOtherTransactions.length, value: sum(legacyOtherTransactions.map((row) => Number(row.amount ?? 0))) },
    OTHER_CLASSIFIED_CAUSES_DECOMPOSITION: otherDecomposition,
    CLASSIFIED_BUT_NOT_DECOMPOSED: { count: rows.filter((row) => row.category === 'UNRESOLVED').length, value: classifiedButNotDecomposed },
    EXPLAINED_SUMUP_SIDE_VALUE: explained,
    VERIFIED_MATCHED_VALUE: verifiedValue,
    UNEXPLAINED_RESIDUAL: unresolvedResidual,
    VERIFIED_MATCHES: verifiedPairs.map((pair) => ({ tiny_reference: pair.tiny.references[0], tiny_date: pair.tiny.saleDate, tiny_value: pair.tiny.value, sumup_reference: pair.tx.transaction_code, sumup_date: dateOnly(pair.tx.timestamp_utc), sumup_value: pair.tx.amount })),
    MATCH_STATUS_COUNTS: counts,
    SIGNED_VALUE_GAP_BRIDGE: bridgeReport.global,
    MONTHLY_SIGNED_BRIDGE: bridgeReport.monthly,
    TOP_MONTH_ROOT_CAUSES: topMonths,
    RULES: {
      VERIFIED: 'Somente match_reason.v2_classification VERIFIED_EXACT ou VERIFIED_COMPOSITE; este relatório não cria match.',
      CANDIDATE_ONLY: 'evidência suficiente para investigação, mas sem promoção a match quando não há vínculo estrito armazenado.',
      TRANSACTION_NOT_FROM_TINY_UNIVERSE: 'nenhum Tiny comparável com mesmo valor bruto normalizado.',
      DATE_SHIFT: 'valor bruto único coincide e a data SumUp diverge; payout/due_date decide INSTALLMENT_DATE_SHIFT.',
      FEE_OR_GROSS_NET_EFFECT: 'payout líquido coincide com Tiny e difere do bruto SumUp.',
      AMBIGUOUS: 'mais de um candidato determinístico; não forçar match.',
      CLASSIFIED_BUT_NOT_DECOMPOSED: 'somente categoria UNRESOLVED; nenhuma categoria genérica é usada para encerrar causa determinística.',
    },
  }, null, 2))
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
