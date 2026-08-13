import { describe, it, expect, beforeEach } from 'vitest'

describe('signState / verifyState', () => {
  beforeEach(() => {
    process.env.OLIST_STATE_SECRET = 'test-secret-at-least-32-characters-long'
  })

  it('round-trips a valid payload', async () => {
    const { signState, verifyState } = await import('@/lib/olist/state')
    const token = signState({ orgId: '00000000-0000-0000-0000-000000000001' })
    const result = verifyState(token)
    expect(result).toEqual({ orgId: '00000000-0000-0000-0000-000000000001' })
  })

  it('rejects a tampered token', async () => {
    const { signState, verifyState } = await import('@/lib/olist/state')
    const token = signState({ orgId: '00000000-0000-0000-0000-000000000001' })
    const tampered = token.slice(0, -2) + 'xx'
    expect(verifyState(tampered)).toBeNull()
  })

  it('rejects garbage input', async () => {
    const { verifyState } = await import('@/lib/olist/state')
    expect(verifyState('not-a-real-token')).toBeNull()
  })
})
