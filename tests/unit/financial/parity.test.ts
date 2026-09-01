import { describe, expect, it } from 'vitest'
import { assessFinancialParity } from '@/lib/financial/parity'

describe('financial parity', () => {
  it('blocks fee value parity when SumUp fee source is null', () => {
    const result = assessFinancialParity({
      feeDimensionRows: 4,
      transactions: 710,
      transactionsWithFee: 0,
      seasonalityRows: 12,
      receiptProfileRows: 8,
    })

    expect(result.feeDimensionParity).toBe('PASS')
    expect(result.feeValueParity).toBe('BLOCKED_SOURCE_DATA')
    expect(result.seasonalityParity).toBe('PASS')
    expect(result.receiptProfileParity).toBe('PASS')
    expect(result.powerQueryFullParity).toBe('BLOCKED_SOURCE_DATA')
  })

  it('passes only when every source dimension is present', () => {
    expect(assessFinancialParity({ feeDimensionRows: 1, transactions: 2, transactionsWithFee: 2, seasonalityRows: 1, receiptProfileRows: 1 }).powerQueryFullParity).toBe('PASS')
  })
})
