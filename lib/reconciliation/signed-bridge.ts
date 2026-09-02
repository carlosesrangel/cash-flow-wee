export type SignedBridgeLine = {
  category: string
  signedValue: number
  evidence: string
}

export type SignedBridgeResult = {
  lines: SignedBridgeLine[]
  signedTotal: number
  actualSumup: number
  check: number
  passesCentTolerance: boolean
}

const money = (value: number) => Math.round(value * 100) / 100

/**
 * Builds a transparent Tiny -> SumUp bridge. The negative Tiny offset is
 * intentional: a comparable universe has rows that exist only in Tiny, and
 * hiding those rows would make the bridge look like a forced match.
 */
export function buildSignedBridge(input: {
  tinyComparableValue: number
  actualSumupValue: number
  unmatchedSumupByCategory: Array<{ category: string; value: number; evidence: string }>
  unmatchedTinyValue: number
  verifiedDateAlignmentValue?: number
}): SignedBridgeResult {
  const lines: SignedBridgeLine[] = [
    { category: 'TINY_COMPARABLE', signedValue: money(input.tinyComparableValue), evidence: 'normalized Tiny card sales in the common period' },
    ...input.unmatchedSumupByCategory.map((item) => ({ category: item.category, signedValue: money(item.value), evidence: item.evidence })),
    { category: 'TINY_UNMATCHED_OFFSET', signedValue: money(-input.unmatchedTinyValue), evidence: 'Tiny comparable rows without a verified SumUp representation' },
    { category: 'VERIFIED_MATCH_DATE_ALIGNMENT', signedValue: money(input.verifiedDateAlignmentValue ?? 0), evidence: 'signed sale-month to transaction-month movement; net zero when dates are equal' },
  ]
  const signedTotal = money(lines.reduce((total, line) => total + line.signedValue, 0))
  const actualSumup = money(input.actualSumupValue)
  const check = money(signedTotal - actualSumup)
  return { lines, signedTotal, actualSumup, check, passesCentTolerance: Math.abs(check) <= 0.01 }
}

