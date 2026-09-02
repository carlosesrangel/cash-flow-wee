import { describe, expect, it } from 'vitest'
import { buildComparableUniverseReport, type ComparableTinyRow, type ComparableSumupRow } from '@/lib/reconciliation/comparable-universe'

describe('comparable Tiny/SumUp universe', () => {
  it('keeps the common period and reports status/value bridge without fuzzy matching', () => {
    const tiny: ComparableTinyRow[] = [
      { id: 'nf-1', value: 100, date: '2025-01-10', paymentMethod: 'Cartão de crédito', status: 'normal', reference: '1/1', installment: 1 },
      { id: 'pix-1', value: 50, date: '2025-01-12', paymentMethod: 'PIX', status: 'normal', reference: null, installment: null },
    ]
    const sumup: ComparableSumupRow[] = [
      { id: 'tx-1', transactionId: 'tx-1', value: 90, grossEstimate: 90, date: '2025-01-10', status: 'SUCCESSFUL', paymentType: 'POS', installment: 1, eventType: 'SALE' },
      { id: 'tx-old', transactionId: 'tx-old', value: 30, grossEstimate: 30, date: '2020-01-10', status: 'SUCCESSFUL', paymentType: 'POS', installment: 1, eventType: 'SALE' },
      { id: 'tx-failed', transactionId: 'tx-failed', value: 20, grossEstimate: 20, date: '2025-01-11', status: 'FAILED', paymentType: 'POS', installment: 1, eventType: 'SALE' },
    ]
    const report = buildComparableUniverseReport(tiny, sumup)
    expect(report.COMPARABLE_START_DATE).toBe('2025-01-10')
    expect(report.COMPARABLE_END_DATE).toBe('2025-01-10')
    expect(report.TINY_COMPARABLE_COUNT).toBe(1)
    expect(report.TINY_COMPARABLE_VALUE).toBe(100)
    expect(report.SUMUP_COMPARABLE_COUNT).toBe(1)
    expect(report.SUMUP_COMPARABLE_VALUE).toBe(90)
    expect(report.TINY_BRIDGE.NON_COMPARABLE.count).toBe(1)
    expect(report.SUMUP_BRIDGE.FAILED.count).toBe(1)
    expect(report.COMPARABLE_VALUE_VARIANCE).toBe(10)
  })
})
