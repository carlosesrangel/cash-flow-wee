import { describe, expect, it } from 'vitest'
import { buildSignedBridge } from '@/lib/reconciliation/signed-bridge'

describe('signed Tiny/SumUp value bridge', () => {
  it('closes the factual comparable universe within one cent', () => {
    const result = buildSignedBridge({
      tinyComparableValue: 364533.20,
      actualSumupValue: 483001.41,
      unmatchedSumupByCategory: [
        { category: 'SALE_DATE_VS_PAYMENT_DATE_SHIFT', value: 217545, evidence: 'same gross amount, different transaction date' },
        { category: 'INSTALLMENT_DATE_SHIFT', value: 11185, evidence: 'payout date aligns with Tiny installment date' },
        { category: 'TRANSACTIONS_NOT_FROM_TINY_UNIVERSE', value: 142038.41, evidence: 'no same-value Tiny row' },
        { category: 'MULTIPLE_TINY_ORDERS_PER_SUMUP', value: 70815, evidence: 'multiple Tiny candidates remain ambiguous' },
        { category: 'REPRESENTATION_DIFFERENCE', value: 32318, evidence: 'unique candidate without strict identifier' },
        { category: 'INSTALLMENT_GRANULARITY', value: 620, evidence: 'installment grain differs' },
      ],
      unmatchedTinyValue: 356053.20,
    })
    expect(result.passesCentTolerance).toBe(true)
    expect(Math.abs(result.signedTotal - result.actualSumup)).toBeLessThanOrEqual(0.01)
    expect(result.check).toBe(0)
  })

  it('fails the check when a material amount is omitted', () => {
    const result = buildSignedBridge({
      tinyComparableValue: 100,
      actualSumupValue: 120,
      unmatchedSumupByCategory: [],
      unmatchedTinyValue: 0,
    })
    expect(result.passesCentTolerance).toBe(false)
    expect(Math.abs(result.signedTotal - result.actualSumup)).toBeGreaterThan(0.01)
  })
})
