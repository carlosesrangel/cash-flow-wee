import { describe, expect, it } from 'vitest'
import { reconcileTinyCards, reconciliationMetrics } from '@/lib/reconciliation/deterministic'

describe('deterministic card reconciliation', () => {
  it('matches by shared identifier before amount/date fallback', () => {
    const result = reconcileTinyCards([{ id: 'tiny-1', externalId: 'abc', amount: 100, date: '2026-09-01' }], [{ id: 'sumup-1', externalId: 'abc', amount: 99, date: '2026-09-03' }])
    expect(result[0]).toMatchObject({ status: 'MATCHED', reason: 'Identificador compartilhado' })
  })
  it('does not fuzzy-match ambiguous or non-card sales', () => {
    const result = reconcileTinyCards([{ id: 'pix-1', amount: 10, date: '2026-09-01', paymentMethod: 'Pix' }, { id: 'tiny-2', amount: 20, date: '2026-09-01' }], [{ id: 'sumup-1', amount: 20, date: '2026-09-01' }, { id: 'sumup-2', amount: 20, date: '2026-09-01' }])
    expect(result[0].status).toBe('NOT_APPLICABLE_PIX')
    expect(result[1].status).toBe('AMBIGUOUS')
    expect(result.filter((row) => row.status === 'UNMATCHED_SUMUP')).toHaveLength(2)
  })
  it('reports value-based match rate and variance', () => {
    const metrics = reconciliationMetrics(reconcileTinyCards([{ id: 'a', amount: 100, date: '2026-09-01' }], [{ id: 'b', amount: 100, date: '2026-09-01' }]))
    expect(metrics).toMatchObject({ matched: 1, matchRate: 1, valueReconciled: 100, valueVariance: 0 })
  })
})
