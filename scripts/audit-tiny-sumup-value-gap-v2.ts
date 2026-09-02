#!/usr/bin/env node
/** Factual bridge for the comparable SumUp/Tiny value gap. Read-only. */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { isVerifiedReconciliation } from '@/lib/reconciliation/verification'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID
type Ar = { id: string; valor: number | null; data_emissao: string | null; data_vencimento: string | null; numero_documento: string | null; forma_recebimento_nome: string | null }
type Tx = { id: string; transaction_code: string | null; transaction_id: string | null; amount: number | null; timestamp_utc: string | null; status: string | null; simple_status: string | null; payment_type: string | null; installments_count: number | null; refunded_amount: number | null }
type Event = { transaction_id: string; event_type: string; status: string; amount: number | null }
type Match = { olist_accounts_receivable_id: string; sumup_transaction_id: string | null; status: string; match_reason: Record<string, unknown> | null }
type TinySale = { id: string; value: number; date: string | null; installments: number | null; arIds: string[]; identifiers: string[] }
type Bucket = { count: number; value: number; examples?: string[] }
const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()
const dateOnly = (value: string | null | undefined) => value?.slice(0, 10) ?? null
const money = (value: number) => Math.round(value * 100) / 100
const isTinyCard = (value: string | null) => ['cartão de crédito', 'cartão de débito', 'cartao de credito', 'cartao de debito'].includes(norm(value))
const isSumupCard = (value: string | null) => ['pos', 'ecom'].includes(norm(value))
const isSuccessful = (row: Tx) => ['successful', 'success', 'reconciled', 'settled', 'paid_out', 'scheduled', 'pending'].includes(norm(row.status)) || ['successful', 'success', 'reconciled', 'settled', 'paid_out', 'scheduled', 'pending'].includes(norm(row.simple_status))
const sum = (rows: Array<{ value: number }>) => money(rows.reduce((total, row) => total + row.value, 0))
async function load<T>(admin: ReturnType<typeof createAdminSupabaseClient>, table: string, select: string, filter: (query: any) => any) { return fetchAllPages<T>((from, to) => filter(admin.from(table).select(select).range(from, to)), `Falha ao carregar ${table}`) }

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const admin = createAdminSupabaseClient()
  const [ars, txs, events, matches] = await Promise.all([
    load<Ar>(admin, 'olist_accounts_receivable', 'id, valor, data_emissao, data_vencimento, numero_documento, forma_recebimento_nome', (q) => q.eq('org_id', orgId)),
    load<Tx>(admin, 'sumup_transactions', 'id, transaction_code, transaction_id, amount, timestamp_utc, status, simple_status, payment_type, installments_count, refunded_amount', (q) => q.eq('org_id', orgId)),
    load<Event>(admin, 'sumup_transaction_events', 'transaction_id, event_type, status, amount', (q) => q.eq('org_id', orgId)),
    load<Match>(admin, 'reconciliation_matches', 'olist_accounts_receivable_id, sumup_transaction_id, status, match_reason', (q) => q.eq('org_id', orgId)),
  ])
  const groups = new Map<string, TinySale>()
  for (const row of ars.filter((item) => isTinyCard(item.forma_recebimento_nome) && Number(item.valor ?? 0) > 0)) {
    const reference = row.numero_documento?.trim() || row.id
    const saleKey = reference.replace(/\/\d+$/, '')
    const installment = reference.match(/\/(\d+)$/)?.[1] ? Number(reference.match(/\/(\d+)$/)?.[1]) : null
    const existing = groups.get(saleKey)
    if (!existing) groups.set(saleKey, { id: saleKey, value: Number(row.valor ?? 0), date: dateOnly(row.data_emissao || row.data_vencimento), installments: installment, arIds: [row.id], identifiers: [norm(reference)] })
    else { existing.value = money(existing.value + Number(row.valor ?? 0)); existing.arIds.push(row.id); existing.installments = Math.max(existing.installments ?? 0, installment ?? 0) || null; existing.identifiers.push(norm(reference)); }
  }
  const tiny = [...groups.values()].filter((row) => row.date).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const arToSale = new Map<string, TinySale>()
  for (const sale of tiny) for (const id of sale.arIds) arToSale.set(id, sale)
  const verified = matches.filter((row) => isVerifiedReconciliation(row) && row.sumup_transaction_id && arToSale.has(row.olist_accounts_receivable_id))
  const verifiedTx = new Set(verified.map((row) => row.sumup_transaction_id!))
  const verifiedSale = new Set(verified.map((row) => arToSale.get(row.olist_accounts_receivable_id)!.id))
  const successfulCard = txs.filter((row) => isSumupCard(row.payment_type) && isSuccessful(row) && Number(row.amount ?? 0) > 0 && row.timestamp_utc)
  const tinyDates = tiny.map((row) => row.date!).sort(); const sumupDates = successfulCard.map((row) => dateOnly(row.timestamp_utc)!).sort()
  const start = tinyDates[0] > sumupDates[0] ? tinyDates[0] : sumupDates[0]; const end = tinyDates.at(-1)! < sumupDates.at(-1)! ? tinyDates.at(-1)! : sumupDates.at(-1)!
  const tinyComparable = tiny.filter((row) => row.date! >= start && row.date! <= end)
  const sumupComparable = successfulCard.filter((row) => dateOnly(row.timestamp_utc)! >= start && dateOnly(row.timestamp_utc)! <= end)
  const eventNet = new Map<string, number>()
  for (const event of events.filter((row) => norm(row.event_type) === 'payout' && Number(row.amount ?? 0) > 0)) eventNet.set(event.transaction_id, money((eventNet.get(event.transaction_id) ?? 0) + Number(event.amount ?? 0)))
  const identifiers = new Map<string, TinySale[]>()
  for (const sale of tinyComparable) for (const id of sale.identifiers) identifiers.set(id, [...(identifiers.get(id) ?? []), sale])
  const byCategory = new Map<string, Bucket>()
  const add = (category: string, row: Tx) => { const current = byCategory.get(category) ?? { count: 0, value: 0, examples: [] }; current.count += 1; current.value = money(current.value + Number(row.amount ?? 0)); if (current.examples!.length < 5) current.examples!.push(row.transaction_code ?? row.id); byCategory.set(category, current) }
  for (const tx of sumupComparable.filter((row) => !verifiedTx.has(row.id))) {
    const txKeys = [tx.transaction_code, tx.transaction_id].map(norm).filter(Boolean)
    const idCandidates = [...new Set(txKeys.flatMap((key) => (identifiers.get(key) ?? []).map((sale) => sale.id)))]
    const amountCandidates = tinyComparable.filter((sale) => Math.abs(sale.value - Number(tx.amount ?? 0)) < 0.01)
    const dateCandidates = amountCandidates.filter((sale) => sale.date === dateOnly(tx.timestamp_utc))
    const net = eventNet.get(tx.id) ?? null
    const netCandidates = net == null ? [] : tinyComparable.filter((sale) => Math.abs(sale.value - net) < 0.01)
    let category = 'OTHER_CLASSIFIED_CAUSES'
    if (Number(tx.refunded_amount ?? 0) > 0) category = 'REFUNDS'
    else if (idCandidates.length) category = 'DUPLICATE_OR_REPRESENTATION_DIFFERENCE'
    else if (netCandidates.length === 1 && Math.abs(Number(tx.amount ?? 0) - Number(net)) > 0.01) category = 'FEE_OR_GROSS_NET_EFFECT'
    else if (dateCandidates.length > 1) category = 'DUPLICATE_OR_REPRESENTATION_DIFFERENCE'
    else if (dateCandidates.length === 1 && dateCandidates[0].installments != null && tx.installments_count !== dateCandidates[0].installments) category = 'INSTALLMENT_GRANULARITY'
    else if (amountCandidates.length === 1 && dateCandidates.length === 0) category = 'DATE_ALIGNMENT'
    else if (amountCandidates.length === 0) category = 'TRANSACTIONS_NOT_FROM_TINY_UNIVERSE'
    add(category, tx)
  }
  const unmatchedTinyValue = sum(tinyComparable.filter((row) => !verifiedSale.has(row.id)).map((row) => ({ value: row.value })))
  const verifiedSumupValue = sum(sumupComparable.filter((row) => verifiedTx.has(row.id)).map((row) => ({ value: Number(row.amount ?? 0) })))
  const comparableSumupValue = sum(sumupComparable.map((row) => ({ value: Number(row.amount ?? 0) })))
  const comparableTinyValue = sum(tinyComparable.map((row) => ({ value: row.value })))
  const unmatchedSumupValue = sum(sumupComparable.filter((row) => !verifiedTx.has(row.id)).map((row) => ({ value: Number(row.amount ?? 0) })))
  const detailedTotal = sum([...byCategory.values()].map((bucket) => ({ value: bucket.value })))
  const gap = money(comparableSumupValue - comparableTinyValue)
  const verifiedTinyValue = sum(tinyComparable.filter((row) => verifiedSale.has(row.id)).map((row) => ({ value: row.value })))
  const verifiedValueVariance = money(verifiedTinyValue - verifiedSumupValue)
  console.log(JSON.stringify({ SUMUP_COMPARABLE_VALUE: comparableSumupValue, TINY_COMPARABLE_VALUE: comparableTinyValue, VALUE_GAP: gap, VERIFIED_MATCHED_VALUE_SUMUP: verifiedSumupValue, VERIFIED_MATCHED_VALUE_TINY: verifiedTinyValue, VERIFIED_VALUE_VARIANCE: verifiedValueVariance, UNMATCHED_SUMUP_VALUE: unmatchedSumupValue, UNMATCHED_TINY_VALUE: unmatchedTinyValue, DETAILED_SUMUP_UNMATCHED_CAUSES: Object.fromEntries([...byCategory.entries()]), DETAILED_CAUSES_TOTAL: detailedTotal, BRIDGE: { START: comparableSumupValue, MINUS_SUMUP_UNMATCHED_CAUSES: detailedTotal, PLUS_TINY_UNMATCHED_OFFSET: unmatchedTinyValue, PLUS_VERIFIED_VALUE_VARIANCE: verifiedValueVariance, EXPECTED_TINY_COMPARABLE_VALUE: money(comparableSumupValue - detailedTotal + unmatchedTinyValue + verifiedValueVariance), CHECK: money(comparableSumupValue - detailedTotal + unmatchedTinyValue + verifiedValueVariance - comparableTinyValue) }, CLASSIFICATION_NOTE: 'As categorias são mutuamente exclusivas por transação. O offset Tiny explicita que a ponte compara dois universos; não é um match implícito. O primeiro relatório legado superestimava o SumUp comparável ao usar a menor data de todo o Tiny, incluindo populações não-cartão.', RULES: { TRANSACTIONS_NOT_FROM_TINY_UNIVERSE: 'nenhuma venda Tiny com mesmo valor no universo comparável', DUPLICATE_OR_REPRESENTATION_DIFFERENCE: 'identificador reaparece ou há mais de um candidato valor/data', INSTALLMENT_GRANULARITY: 'valor/data encontrados, mas número de parcelas diverge', REFUNDS: 'refunded_amount positivo', DATE_ALIGNMENT: 'mesmo valor, mas data de venda/transação diverge', FEE_OR_GROSS_NET_EFFECT: 'valor bruto SumUp diverge do payout e o payout coincide com Tiny', OTHER_CLASSIFIED_CAUSES: 'resíduo sem evidência determinística; requer ação, não é match' } }, null, 2))
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
