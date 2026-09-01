export type ParityStatus = 'PASS' | 'BLOCKED_SOURCE_DATA' | 'PENDING'

export type FinancialParity = {
  feeDimensionParity: ParityStatus
  feeValueParity: ParityStatus
  seasonalityParity: ParityStatus
  receiptProfileParity: ParityStatus
  powerQueryFullParity: ParityStatus
}

/**
 * Keeps source availability separate from a calculated numeric value. In
 * particular, a missing SumUp fee is not equivalent to a historical 0 fee.
 */
export function assessFinancialParity(input: {
  feeDimensionRows: number
  transactions: number
  transactionsWithFee: number
  seasonalityRows: number
  receiptProfileRows: number
}): FinancialParity {
  const feeDimensionParity: ParityStatus = input.feeDimensionRows > 0 ? 'PASS' : 'PENDING'
  const feeValueParity: ParityStatus = input.transactions > 0 && input.transactionsWithFee === input.transactions
    ? 'PASS'
    : 'BLOCKED_SOURCE_DATA'
  const seasonalityParity: ParityStatus = input.seasonalityRows > 0 ? 'PASS' : 'PENDING'
  const receiptProfileParity: ParityStatus = input.receiptProfileRows > 0 ? 'PASS' : 'PENDING'
  const powerQueryFullParity: ParityStatus =
    feeDimensionParity === 'PASS' &&
    feeValueParity === 'PASS' &&
    seasonalityParity === 'PASS' &&
    receiptProfileParity === 'PASS'
      ? 'PASS'
      : feeValueParity === 'BLOCKED_SOURCE_DATA'
        ? 'BLOCKED_SOURCE_DATA'
        : 'PENDING'

  return { feeDimensionParity, feeValueParity, seasonalityParity, receiptProfileParity, powerQueryFullParity }
}
