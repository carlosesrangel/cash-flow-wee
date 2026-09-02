import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyPayableStatus } from '@/lib/payables/classify-status'
import { calculatePayableTotals, getPayableStatusCounts, matchesPayableFilter, type PayableFilterRow } from '@/lib/payables/filters'

const baseFilters = { status: 'all' as const, categoria: 'all', fornecedor: '', minValue: null, maxValue: null }
vi.useFakeTimers()
vi.setSystemTime(new Date('2026-09-01T12:00:00-03:00'))
const status = (situacao: string, saldo: number | null, valor: number | null, date: string | null) => classifyPayableStatus(situacao, saldo, valor, date)

const rows: PayableFilterRow[] = [
  { payableStatus: status('aberto', 100, 100, '2026-08-31'), fornecedorNome: 'Fornecedor A', categoria: 'Fornecedores', valor: 100, saldo: 100, dataVencimento: '2026-08-31' },
  { payableStatus: status('aberto', 50, 100, '2026-09-01'), fornecedorNome: 'Fornecedor A', categoria: 'Impostos', valor: 100, saldo: 50, dataVencimento: '2026-09-01' },
  { payableStatus: status('pago', 0, 100, '2026-08-31'), fornecedorNome: 'Fornecedor B', categoria: null, valor: 100, saldo: 0, dataVencimento: '2026-08-31' },
]

describe('payable filters and totals', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T12:00:00-03:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('counts every row once and groups due soon into em aberto', () => {
    const counts = getPayableStatusCounts(rows)
    expect(counts.all).toBe(3)
    expect(counts.open).toBe(1)
    expect(counts.due_soon).toBe(1)
    expect(counts.paid).toBe(1)
    expect(counts.overdue).toBe(1)
  })

  it('combines category and status filters', () => {
    expect(rows.filter((row) => matchesPayableFilter(row, { ...baseFilters, status: 'overdue', categoria: 'Fornecedores' }))).toHaveLength(1)
    expect(rows.filter((row) => matchesPayableFilter(row, { ...baseFilters, status: 'open', categoria: 'Impostos' }))).toHaveLength(1)
    expect(rows.filter((row) => matchesPayableFilter(row, { ...baseFilters, categoria: '__sem_categoria__' }))).toHaveLength(1)
  })

  it('uses remaining saldo for outstanding totals and does not count paid rows', () => {
    expect(calculatePayableTotals(rows)).toEqual({
      openBalance: 150,
      overdueBalance: 100,
      dueSoonBalance: 50,
      openOver7Balance: 0,
    })
  })

  it('reconciles exclusive production status counts without double counting due soon', () => {
    const productionRows: PayableFilterRow[] = [
      ...Array.from({ length: 204 }, () => ({ ...rows[2], payableStatus: status('pago', 0, 100, '2026-08-31') })),
      ...Array.from({ length: 68 }, () => ({ ...rows[0], payableStatus: status('aberto', 100, 100, '2026-08-31') })),
      ...Array.from({ length: 2 }, () => ({ ...rows[1], payableStatus: status('aberto', 50, 100, '2026-09-01') })),
      ...Array.from({ length: 183 }, () => ({ ...rows[0], payableStatus: status('aberto', 100, 100, '2026-09-20'), saldo: 100 })),
    ]
    const counts = getPayableStatusCounts(productionRows)
    const exclusive = productionRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.payableStatus.status] = (acc[row.payableStatus.status] ?? 0) + 1
      return acc
    }, {})
    expect({ total: productionRows.length, ...exclusive, cancelled: exclusive.cancelled ?? 0 }).toMatchObject({ total: 457, paid: 204, overdue: 68, due_soon: 2, open: 183, cancelled: 0 })
    expect((exclusive.paid ?? 0) + (exclusive.overdue ?? 0) + (exclusive.due_soon ?? 0) + (exclusive.open ?? 0) + (exclusive.cancelled ?? 0)).toBe(productionRows.length)
    expect(counts.all).toBe(productionRows.length)
  })
})
