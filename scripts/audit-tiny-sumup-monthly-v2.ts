#!/usr/bin/env node
/** Read-only monthly reconciliation at the normalized sale/transaction grain. */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { isVerifiedReconciliation } from '@/lib/reconciliation/verification'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID
type Ar = { id: string; olist_id: number | null; valor: number | null; data_emissao: string | null; data_vencimento: string | null; numero_documento: string | null; forma_recebimento_nome: string | null; situacao: string | null }
type Tx = { id: string; amount: number | null; timestamp_utc: string | null; payment_type: string | null; installments_count: number | null; status: string | null; simple_status: string | null }
type Match = { olist_accounts_receivable_id: string; sumup_transaction_id: string | null; status: string; match_reason: Record<string, unknown> | null }
type Sale = { id: string; value: number; date: string | null; installments: number | null; method: string | null; status: string | null; arIds: string[] }
const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()
const dateOnly = (value: string | null | undefined) => value?.slice(0, 10) ?? null
const money = (value: number) => Math.round(value * 100) / 100
const isCardTiny = (value: string | null) => ['cartão de crédito', 'cartão de débito', 'cartao de credito', 'cartao de debito'].includes(norm(value))
const isCardSumup = (value: string | null) => ['pos', 'ecom'].includes(norm(value))
const isSuccess = (row: Tx) => ['successful', 'success', 'reconciled', 'settled', 'paid_out', 'scheduled', 'pending'].includes(norm(row.status)) || ['successful', 'success', 'reconciled', 'settled', 'paid_out', 'scheduled', 'pending'].includes(norm(row.simple_status))
const month = (value: string | null) => value?.slice(0, 7) ?? null
const monthsBetween = (start: string, end: string) => { const out: string[] = []; let [year, m] = start.split('-').map(Number); const [endYear, endMonth] = end.split('-').map(Number); while (year < endYear || (year === endYear && m <= endMonth)) { out.push(`${year}-${String(m).padStart(2, '0')}`); m += 1; if (m === 13) { year += 1; m = 1 } } return out }
const sum = (rows: Array<{ value: number }>) => money(rows.reduce((total, row) => total + row.value, 0))
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); if (!sorted.length) return 0; const middle = Math.floor(sorted.length / 2); return money(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) }

async function load<T>(admin: ReturnType<typeof createAdminSupabaseClient>, table: string, select: string, filter: (query: any) => any) {
  return fetchAllPages<T>((from, to) => filter(admin.from(table).select(select).range(from, to)), `Falha ao carregar ${table}`)
}

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const admin = createAdminSupabaseClient()
  const [ars, txs, matches] = await Promise.all([
    load<Ar>(admin, 'olist_accounts_receivable', 'id, olist_id, valor, data_emissao, data_vencimento, numero_documento, forma_recebimento_nome, situacao', (q) => q.eq('org_id', orgId)),
    load<Tx>(admin, 'sumup_transactions', 'id, amount, timestamp_utc, payment_type, installments_count, status, simple_status', (q) => q.eq('org_id', orgId)),
    load<Match>(admin, 'reconciliation_matches', 'olist_accounts_receivable_id, sumup_transaction_id, status, match_reason', (q) => q.eq('org_id', orgId)),
  ])
  const tinyGroups = new Map<string, Sale>()
  for (const row of ars.filter((item) => isCardTiny(item.forma_recebimento_nome) && Number(item.valor ?? 0) > 0)) {
    const reference = row.numero_documento?.trim() || row.id
    const saleKey = reference.replace(/\/\d+$/, '')
    const existing = tinyGroups.get(saleKey)
    const installment = reference.match(/\/(\d+)$/)?.[1] ? Number(reference.match(/\/(\d+)$/)?.[1]) : null
    const rowDate = dateOnly(row.data_emissao || row.data_vencimento)
    if (!existing) tinyGroups.set(saleKey, { id: saleKey, value: Number(row.valor ?? 0), date: rowDate, installments: installment, method: row.forma_recebimento_nome, status: row.situacao, arIds: [row.id] })
    else { existing.value = money(existing.value + Number(row.valor ?? 0)); existing.arIds.push(row.id); existing.installments = Math.max(existing.installments ?? 0, installment ?? 0) || null; if ((rowDate ?? '') < (existing.date ?? '')) existing.date = rowDate }
  }
  const sumupById = new Map(txs.map((row) => [row.id, row]))
  const saleByAr = new Map<string, Sale>()
  for (const sale of tinyGroups.values()) for (const arId of sale.arIds) saleByAr.set(arId, sale)
  const verifiedLinks = matches.filter((match) => isVerifiedReconciliation(match) && match.sumup_transaction_id && saleByAr.has(match.olist_accounts_receivable_id) && sumupById.has(match.sumup_transaction_id))
  const saleToTx = new Map<string, string>()
  const txToSale = new Map<string, string>()
  const ambiguousSaleKeys = new Set<string>()
  for (const link of verifiedLinks) {
    const sale = saleByAr.get(link.olist_accounts_receivable_id)!
    const txId = link.sumup_transaction_id!
    if ((saleToTx.has(sale.id) && saleToTx.get(sale.id) !== txId) || (txToSale.has(txId) && txToSale.get(txId) !== sale.id)) { ambiguousSaleKeys.add(sale.id); continue }
    saleToTx.set(sale.id, txId); txToSale.set(txId, sale.id)
  }
  const tinyRows = [...tinyGroups.values()].filter((row) => row.date)
  const sumupRows = txs.filter((row) => isCardSumup(row.payment_type) && isSuccess(row) && Number(row.amount ?? 0) > 0 && row.timestamp_utc)
  const tinyDates = tinyRows.map((row) => row.date!).sort()
  const sumupDates = sumupRows.map((row) => dateOnly(row.timestamp_utc)!).sort()
  const start = tinyDates[0] > sumupDates[0] ? tinyDates[0] : sumupDates[0]
  const end = tinyDates.at(-1)! < sumupDates.at(-1)! ? tinyDates.at(-1)! : sumupDates.at(-1)!
  const startMonth = start.slice(0, 7); const endMonth = end.slice(0, 7)
  const monthly = monthsBetween(startMonth, endMonth).map((m) => {
    const tiny = tinyRows.filter((row) => row.date?.startsWith(m) && row.date >= start && row.date <= end)
    const sumup = sumupRows.filter((row) => dateOnly(row.timestamp_utc)?.startsWith(m) && (dateOnly(row.timestamp_utc)! >= start && dateOnly(row.timestamp_utc)! <= end))
    const matchedSales = tiny.filter((sale) => { const txId = saleToTx.get(sale.id); const tx = txId ? sumupById.get(txId) : null; return Boolean(tx && !ambiguousSaleKeys.has(sale.id) && month(dateOnly(tx.timestamp_utc)) === m) })
    const matchedTxIds = new Set(matchedSales.map((sale) => saleToTx.get(sale.id)!))
    const ambiguous = [...ambiguousSaleKeys].map((id) => tinyGroups.get(id)).filter((row): row is Sale => Boolean(row?.date?.startsWith(m))).length
    const tinyValue = sum(tiny); const sumupValue = sum(sumup.map((row) => ({ value: Number(row.amount ?? 0) }))); const matchedValue = sum(matchedSales)
    return { MONTH: m, TINY_COUNT: tiny.length, TINY_VALUE: tinyValue, SUMUP_COUNT: sumup.length, SUMUP_VALUE: sumupValue, MATCHED_COUNT: matchedSales.length, MATCHED_VALUE: matchedValue, UNMATCHED_TINY: tiny.length - matchedSales.length, UNMATCHED_SUMUP: sumup.filter((row) => !matchedTxIds.has(row.id)).length, AMBIGUOUS: ambiguous, COUNT_MATCH_RATE: tiny.length ? money(matchedSales.length / tiny.length) : 0, VALUE_MATCH_RATE: tinyValue ? money(matchedValue / tinyValue) : 0, VALUE_VARIANCE: money(tinyValue - sumupValue), TINY_AVERAGE_TICKET: tiny.length ? money(tinyValue / tiny.length) : 0, TINY_MEDIAN_TICKET: median(tiny.map((row) => row.value)), SUMUP_AVERAGE_TICKET: sumup.length ? money(sumupValue / sumup.length) : 0, SUMUP_MEDIAN_TICKET: median(sumup.map((row) => Number(row.amount ?? 0))), TINY_INSTALLMENTS: Object.fromEntries([...new Set(tiny.map((row) => row.installments))].sort((a, b) => (a ?? 0) - (b ?? 0)).map((value) => [String(value ?? 'unknown'), tiny.filter((row) => row.installments === value).length])), SUMUP_INSTALLMENTS: Object.fromEntries([...new Set(sumup.map((row) => row.installments_count))].sort((a, b) => (a ?? 0) - (b ?? 0)).map((value) => [String(value ?? 'unknown'), sumup.filter((row) => row.installments_count === value).length])), SUMUP_STATUS: Object.fromEntries([...new Set(sumup.map((row) => row.status ?? row.simple_status))].map((value) => [String(value), sumup.filter((row) => (row.status ?? row.simple_status) === value).length])), TINY_METHOD: Object.fromEntries([...new Set(tiny.map((row) => row.method))].map((value) => [String(value), tiny.filter((row) => row.method === value).length])), }
  })
  const highestDivergence = [...monthly].sort((a, b) => Math.abs(b.VALUE_VARIANCE) - Math.abs(a.VALUE_VARIANCE)).slice(0, 5).map((row) => row.MONTH)
  console.log(JSON.stringify({ COMPARABLE_START_DATE: start, COMPARABLE_END_DATE: end, TINY_RECORD_GRAIN: '1 venda cartão Tiny com parcelas agregadas pelo numero_documento', SUMUP_RECORD_GRAIN: '1 transação SumUp', VERIFIED_LINKS_USED: verifiedLinks.length, MONTHLY: monthly, HIGHEST_DIVERGENCE_MONTHS: highestDivergence, NOTE: 'MATCHED usa somente classificações V2 verificadas; divergência de mês entre as fontes não é forçada para dentro de um mês.' }, null, 2))
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
