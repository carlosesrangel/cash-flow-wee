import { describe, expect, it, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/payments/engine', () => ({ loadPayableCandidates: vi.fn() }))
vi.mock('@/lib/ledger/populate', () => ({ calculateLedgerBalance: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { loadPayableCandidates } from '@/lib/payments/engine'
import { calculateLedgerBalance } from '@/lib/ledger/populate'

const MEMBER = {
  orgId: '00000000-0000-0000-0000-000000000001',
  profileId: 'profile-1',
  role: 'MANAGER' as const,
}

describe('POST /api/payments/impact', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 when there is no authenticated member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/payments/impact/route')
    const response = await POST(new Request('http://localhost/api/payments/impact', { method: 'POST' }) as never)

    expect(response.status).toBe(401)
  })

  it('returns 400 instead of throwing when the request body is not valid JSON', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)

    const request = new Request('http://localhost/api/payments/impact', {
      method: 'POST',
      body: '{',
      headers: { 'content-type': 'application/json' },
    })

    const { POST } = await import('@/app/api/payments/impact/route')
    const response = await POST(request as never)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid JSON body' })
    expect(loadPayableCandidates).not.toHaveBeenCalled()
    expect(calculateLedgerBalance).not.toHaveBeenCalled()
  })
})
