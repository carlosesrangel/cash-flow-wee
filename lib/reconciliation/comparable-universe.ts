import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'

export type ComparableTinyRow = {
  id: string
  value: number
  date: string | null
  paymentMethod: string | null
  status: string | null
  reference: string | null
  installment: number | null
}

export type ComparableSumupRow = {
  id: string
  transactionId: string | null
  value: number
  grossEstimate: number | null
  date: string | null
  status: string | null
  paymentType: string | null
  installment: number | null
  eventType: string | null
}

export type BridgeBucket = { count: number; value: number }

export type ComparableUniverseReport = {
  TINY_MIN_DATE: string | null
  TINY_MAX_DATE: string | null
  SUMUP_MIN_DATE: string | null
  SUMUP_MAX_DATE: string | null
  COMPARABLE_START_DATE: string | null
  COMPARABLE_END_DATE: string | null
  TINY_RECORD_GRAIN: string
  SUMUP_RECORD_GRAIN: string
  TINY_COMPARABLE_COUNT: number
  TINY_COMPARABLE_VALUE: number
  SUMUP_COMPARABLE_COUNT: number
  SUMUP_COMPARABLE_VALUE: number
  TINY_BRIDGE: Record<'RAW_VALUE' | 'OUTSIDE_PERIOD' | 'CANCELLED' | 'REFUNDED' | 'NON_COMPARABLE' | 'COMPARABLE_VALUE', BridgeBucket>
  SUMUP_BRIDGE: Record<'RAW_VALUE' | 'OUTSIDE_PERIOD' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | 'NON_COMPARABLE' | 'FEES_OR_OTHER_COMPONENTS' | 'COMPARABLE_VALUE', BridgeBucket>
  COMPARABLE_VALUE_VARIANCE: number
}

const money = (value: number) => Math.round(value * 100) / 100
const normalized = (value: unknown) => String(value ?? '').trim().toLowerCase()
const dateOnly = (value: string | null | undefined) => value ? value.slice(0, 10) : null
const isCancelled = (value: unknown) => ['cancelled', 'canceled', 'cancelado', 'cancelada'].includes(normalized(value))
const isRefunded = (value: unknown) => ['refund', 'refunded', 'estornado', 'estornada'].includes(normalized(value))
const isCardTiny = (value: string | null) => ['cartão de crédito', 'cartão de débito', 'cartao de credito', 'cartao de debito'].includes(normalized(value))
const isCardSumup = (value: string | null) => ['pos', 'ecom'].includes(normalized(value))
const isSuccessfulSumup = (row: ComparableSumupRow) => ['successful', 'success', 'reconciled', 'settled', 'paid_out', 'scheduled', 'pending'].includes(normalized(row.status))

function between(value: string | null, start: string | null, end: string | null) {
  return Boolean(value && start && end && value >= start && value <= end)
}

function bounds(values: Array<string | null>) {
  const dates = values.filter((value): value is string => Boolean(value)).sort()
  return { min: dates[0] ?? null, max: dates.at(-1) ?? null }
}

function bucket(rows: Array<{ value: number }>): BridgeBucket {
  return { count: rows.length, value: money(rows.reduce((sum, row) => sum + row.value, 0)) }
}

export function buildComparableUniverseReport(tiny: ComparableTinyRow[], sumup: ComparableSumupRow[]): ComparableUniverseReport {
  const tinyBounds = bounds(tiny.map((row) => row.date))
  const sumupBounds = bounds(sumup.filter(isSuccessfulSumup).map((row) => row.date))
  const comparableStart = tinyBounds.min && sumupBounds.min ? (tinyBounds.min > sumupBounds.min ? tinyBounds.min : sumupBounds.min) : null
  const comparableEnd = tinyBounds.max && sumupBounds.max ? (tinyBounds.max < sumupBounds.max ? tinyBounds.max : sumupBounds.max) : null

  const tinyComparable = tiny.filter((row) => !isCancelled(row.status) && !isRefunded(row.status) && isCardTiny(row.paymentMethod) && between(row.date, comparableStart, comparableEnd))
  const sumupComparable = sumup.filter((row) => isSuccessfulSumup(row) && isCardSumup(row.paymentType) && between(row.date, comparableStart, comparableEnd))
  const tinyCard = tiny.filter((row) => isCardTiny(row.paymentMethod))
  const sumupCard = sumup.filter((row) => isCardSumup(row.paymentType))

  const tinyBridge = {
    RAW_VALUE: bucket(tiny),
    OUTSIDE_PERIOD: bucket(tinyCard.filter((row) => !between(row.date, comparableStart, comparableEnd) && !isCancelled(row.status) && !isRefunded(row.status))),
    CANCELLED: bucket(tiny.filter((row) => isCancelled(row.status))),
    REFUNDED: bucket(tiny.filter((row) => isRefunded(row.status))),
    NON_COMPARABLE: bucket(tiny.filter((row) => !isCardTiny(row.paymentMethod) && !isCancelled(row.status) && !isRefunded(row.status))),
    COMPARABLE_VALUE: bucket(tinyComparable),
  }
  const sumupBridge = {
    RAW_VALUE: bucket(sumup),
    OUTSIDE_PERIOD: bucket(sumupCard.filter((row) => isSuccessfulSumup(row) && !between(row.date, comparableStart, comparableEnd))),
    FAILED: bucket(sumup.filter((row) => ['failed', 'failure'].includes(normalized(row.status)))),
    CANCELLED: bucket(sumup.filter((row) => isCancelled(row.status))),
    REFUNDED: bucket(sumup.filter((row) => isRefunded(row.status) || Number(row.value) < 0)),
    NON_COMPARABLE: bucket(sumup.filter((row) => !isCardSumup(row.paymentType) && !['failed', 'failure'].includes(normalized(row.status)) && !isCancelled(row.status) && !isRefunded(row.status))),
    FEES_OR_OTHER_COMPONENTS: { count: 0, value: 0 },
    COMPARABLE_VALUE: bucket(sumupComparable.map((row) => ({ value: row.grossEstimate ?? row.value }))),
  }

  // The SumUp event amount is normally net of fees. The comparable bridge is
  // therefore explicit about gross-estimate vs. event-net basis instead of
  // silently treating the difference as a match.
  sumupBridge.FEES_OR_OTHER_COMPONENTS = {
    count: sumupComparable.length,
    value: money(sumupComparable.reduce((sum, row) => sum + ((row.grossEstimate ?? row.value) - row.value), 0)),
  }

  return {
    TINY_MIN_DATE: tinyBounds.min,
    TINY_MAX_DATE: tinyBounds.max,
    SUMUP_MIN_DATE: sumupBounds.min,
    SUMUP_MAX_DATE: sumupBounds.max,
    COMPARABLE_START_DATE: comparableStart,
    COMPARABLE_END_DATE: comparableEnd,
    TINY_RECORD_GRAIN: '1 venda cartão Tiny (parcelas agregadas pelo documento)',
    SUMUP_RECORD_GRAIN: '1 transação de venda SumUp',
    TINY_COMPARABLE_COUNT: tinyComparable.length,
    TINY_COMPARABLE_VALUE: money(tinyComparable.reduce((sum, row) => sum + row.value, 0)),
    SUMUP_COMPARABLE_COUNT: sumupComparable.length,
    SUMUP_COMPARABLE_VALUE: money(sumupComparable.reduce((sum, row) => sum + (row.grossEstimate ?? row.value), 0)),
    TINY_BRIDGE: tinyBridge,
    SUMUP_BRIDGE: sumupBridge,
    COMPARABLE_VALUE_VARIANCE: money(tinyComparable.reduce((sum, row) => sum + row.value, 0) - sumupComparable.reduce((sum, row) => sum + (row.grossEstimate ?? row.value), 0)),
  }
}

export async function loadComparableUniverse(orgId: string) {
  const admin = createAdminSupabaseClient()
  const [tiny, transactions] = await Promise.all([
    fetchAllPages<{
      id: string; valor: number | null; data_emissao: string | null; data_vencimento: string | null
      forma_recebimento_nome: string | null; situacao: string | null; numero_documento: string | null
    }>((from, to) => admin.from('olist_accounts_receivable').select('id, valor, data_emissao, data_vencimento, forma_recebimento_nome, situacao, numero_documento').eq('org_id', orgId).range(from, to), 'Falha ao carregar recebíveis Tiny'),
    fetchAllPages<{
      id: string; transaction_id: string | null; transaction_code: string | null; amount: number | null; timestamp_utc: string | null; status: string | null; simple_status: string | null; payment_type: string | null; installments_count: number | null; refunded_amount: number | null
    }>((from, to) => admin.from('sumup_transactions').select('id, transaction_id, transaction_code, amount, timestamp_utc, status, simple_status, payment_type, installments_count, refunded_amount').eq('org_id', orgId).range(from, to), 'Falha ao carregar transações SumUp'),
  ])

  // Tiny exposes one AR row per installment. SumUp exposes one sale
  // transaction. Normalize Tiny to one sale/payment event by the invoice
  // reference before comparing; source rows remain untouched in Supabase.
  const tinyGroups = new Map<string, ComparableTinyRow>()
  for (const row of tiny) {
    const reference = row.numero_documento?.trim() || row.id
    const saleKey = reference.replace(/\/\d+$/, '')
    const existing = tinyGroups.get(saleKey)
    if (!existing) {
      tinyGroups.set(saleKey, { id: saleKey, value: Number(row.valor ?? 0), date: dateOnly(row.data_emissao ?? row.data_vencimento), paymentMethod: row.forma_recebimento_nome, status: row.situacao, reference, installment: null })
    } else {
      existing.value = money(existing.value + Number(row.valor ?? 0))
      if ((dateOnly(row.data_emissao ?? row.data_vencimento) ?? '') < (existing.date ?? '')) existing.date = dateOnly(row.data_emissao ?? row.data_vencimento)
    }
  }
  const tinyRows = [...tinyGroups.values()]
  const sumupRows: ComparableSumupRow[] = transactions.map((row) => ({
    id: row.id,
    transactionId: row.transaction_id,
    value: Number(row.amount ?? 0),
    grossEstimate: Number(row.amount ?? 0),
    date: dateOnly(row.timestamp_utc),
    status: row.status ?? row.simple_status,
    paymentType: row.payment_type,
    installment: row.installments_count,
    eventType: 'SALE',
  }))
  return { tinyRows, sumupRows, report: buildComparableUniverseReport(tinyRows, sumupRows) }
}
