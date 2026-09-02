import type { PayableStatus, PayableStatusResult } from '@/lib/payables/classify-status'

export const UNCATEGORIZED_FILTER = '__sem_categoria__'

export type PayableFilterStatus = 'all' | 'open' | 'due_soon' | 'paid' | 'overdue' | 'cancelled'

export type PayableFilterRow = {
  payableStatus: PayableStatusResult
  fornecedorNome: string | null
  categoria: string | null
  valor: number | null
  saldo: number | null
  valorPago?: number | null
  dataVencimento: string | null
}

export type PayableFilterState = {
  status: PayableFilterStatus
  categoria: string
  fornecedor: string
  minValue: number | null
  maxValue: number | null
  dateFrom?: string
  dateTo?: string
}

export type PayableTotals = {
  openBalance: number
  overdueBalance: number
  dueSoonBalance: number
  openOver7Balance: number
}

const OUTSTANDING_STATUSES = new Set<PayableStatus>(['open', 'due_soon', 'overdue'])

export function matchesPayableFilter(row: PayableFilterRow, filters: PayableFilterState): boolean {
  const statusMatches =
    filters.status === 'all' ||
    (filters.status === 'open' && (row.payableStatus.status === 'open' || row.payableStatus.status === 'due_soon')) ||
    row.payableStatus.status === filters.status

  if (!statusMatches) return false

  if (filters.categoria === UNCATEGORIZED_FILTER && row.categoria?.trim()) return false
  if (filters.categoria !== 'all' && filters.categoria !== UNCATEGORIZED_FILTER && row.categoria !== filters.categoria) {
    return false
  }
  if (filters.fornecedor && row.fornecedorNome !== filters.fornecedor) return false
  if (filters.dateFrom && (!row.dataVencimento || row.dataVencimento < filters.dateFrom)) return false
  if (filters.dateTo && (!row.dataVencimento || row.dataVencimento > filters.dateTo)) return false

  const value = knownNumber(row.valor)
  if (filters.minValue !== null && (value === null || value < filters.minValue)) return false
  if (filters.maxValue !== null && (value === null || value > filters.maxValue)) return false

  return true
}

export function getPayableStatusCounts(rows: PayableFilterRow[]) {
  const counts: Record<PayableFilterStatus, number> = {
    all: rows.length,
    open: 0,
    due_soon: 0,
    paid: 0,
    overdue: 0,
    cancelled: 0,
  }

  for (const row of rows) {
    const status = row.payableStatus.status
    if (status === 'open' || status === 'due_soon') counts.open += 1
    if (status in counts) counts[status as PayableFilterStatus] += 1
  }

  return counts
}

export function calculatePayableTotals(rows: PayableFilterRow[]): PayableTotals {
  return rows.reduce<PayableTotals>(
    (totals, row) => {
      if (!OUTSTANDING_STATUSES.has(row.payableStatus.status)) return totals
      const balance = knownNumber(row.saldo)
      if (balance === null || balance <= 0) return totals

      totals.openBalance += balance
      if (row.payableStatus.status === 'overdue') totals.overdueBalance += balance
      if (row.payableStatus.status === 'due_soon') totals.dueSoonBalance += balance
      if (row.payableStatus.status === 'open' && row.dataVencimento) totals.openOver7Balance += balance
      return totals
    },
    { openBalance: 0, overdueBalance: 0, dueSoonBalance: 0, openOver7Balance: 0 }
  )
}

export function getPaidAmount(row: PayableFilterRow): number | null {
  const factual = knownNumber(row.valorPago)
  if (factual !== null) return factual

  const value = knownNumber(row.valor)
  const balance = knownNumber(row.saldo)
  if (value === null || balance === null) return null
  return Math.max(value - balance, 0)
}

function knownNumber(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null
}
