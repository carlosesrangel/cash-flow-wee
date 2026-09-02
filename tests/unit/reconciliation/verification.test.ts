import { describe, expect, it } from 'vitest'
import { isVerifiedReconciliation } from '@/lib/reconciliation/verification'

describe('isVerifiedReconciliation', () => {
  it('accepts only verified classifications with a linked reconciliation status', () => {
    expect(isVerifiedReconciliation({ status: 'reconciliado_automaticamente', match_reason: { v2_classification: 'VERIFIED_EXACT' } })).toBe(true)
    expect(isVerifiedReconciliation({ status: 'reconciliado_manualmente', match_reason: { v2_classification: 'VERIFIED_COMPOSITE' } })).toBe(true)
  })

  it.each(['LEGACY_UNVERIFIED', 'AMBIGUOUS', 'INVALID', 'REPRESENTATION_DIFFERENCE'])('does not treat %s as proof that supersedes AR', (classification) => {
    expect(isVerifiedReconciliation({ status: 'reconciliado_automaticamente', match_reason: { v2_classification: classification } })).toBe(false)
    expect(isVerifiedReconciliation({ status: 'reconciliado_manualmente', match_reason: { v2_classification: classification } })).toBe(false)
  })

  it('does not verify a legacy status when the V2 classification is absent', () => {
    expect(isVerifiedReconciliation({ status: 'reconciliado_automaticamente', match_reason: null })).toBe(false)
  })
})
