import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageReconciliation: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }
const MATCH_ID = 'match-1'

function buildRequest(body: unknown) {
  return new Request(`http://localhost/api/reconciliacao/${MATCH_ID}/confirmar`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function ctx() {
  return { params: Promise.resolve({ id: MATCH_ID }) }
}

function mockAdmin(options: {
  match?: { id: string; candidate_ids: string[]; status: string } | null
  event?: { id: string; transaction_id: string } | null
  /**
   * Rows another `reconciliation_matches` record already holds for the same
   * SumUp event with a LINKED status — backs the duplicate-claim guard's read.
   */
  existingClaims?: Array<{ id: string }>
  updateError?: { message: string } | null
}) {
  const matchMaybeSingle = vi.fn().mockResolvedValue({ data: options.match ?? null, error: null })
  const matchEq2 = vi.fn().mockReturnValue({ maybeSingle: matchMaybeSingle })
  const matchEq1 = vi.fn().mockReturnValue({ eq: matchEq2 })

  // The duplicate-claim guard: .eq().eq().in().neq().limit() → awaited.
  const claimNeqCalls: Array<[string, unknown]> = []
  const claimLimit = vi.fn().mockResolvedValue({ data: options.existingClaims ?? [], error: null })
  const claimNeq = vi.fn((column: string, value: unknown) => {
    claimNeqCalls.push([column, value])
    return { limit: claimLimit }
  })
  const claimIn = vi.fn().mockReturnValue({ neq: claimNeq })
  const claimEq2 = vi.fn().mockReturnValue({ in: claimIn })
  const claimEq1 = vi.fn().mockReturnValue({ eq: claimEq2 })

  const matchSelect = vi.fn((columns: string) =>
    columns.includes('candidate_ids') ? { eq: matchEq1 } : { eq: claimEq1 }
  )

  const eventMaybeSingle = vi.fn().mockResolvedValue({ data: options.event ?? null, error: null })
  const eventEq2 = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
  const eventEq1 = vi.fn().mockReturnValue({ eq: eventEq2 })
  const eventSelect = vi.fn().mockReturnValue({ eq: eventEq1 })

  const updateEq2 = vi.fn().mockResolvedValue({ error: options.updateError ?? null })
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
  const update = vi.fn().mockReturnValue({ eq: updateEq1 })

  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_matches') return { select: matchSelect, update }
    if (table === 'sumup_transaction_events') return { select: eventSelect }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { update, claimIn, claimNeqCalls }
}

describe('POST /api/reconciliacao/[id]/confirmar', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canManageReconciliation', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canManageReconciliation).mockReturnValue(false)

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())

    expect(response.status).toBe(403)
  })

  it('returns 400 when sumupTransactionEventId is missing', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({}), ctx())

    expect(response.status).toBe(400)
  })

  it('returns 404 when the match does not exist in the caller org', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    mockAdmin({ match: null })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())

    expect(response.status).toBe(404)
  })

  it('returns 409 when the match status is not conflito', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    mockAdmin({ match: { id: MATCH_ID, candidate_ids: ['event-1'], status: 'nao_reconciliado' } })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())

    expect(response.status).toBe(409)
  })

  it('returns 400 when sumupTransactionEventId is not one of the stored candidates', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    mockAdmin({ match: { id: MATCH_ID, candidate_ids: ['event-1', 'event-2'], status: 'conflito' } })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-999' }), ctx())

    expect(response.status).toBe(400)
  })

  it('confirms the match and returns ok when the candidate is valid', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    const { update } = mockAdmin({
      match: { id: MATCH_ID, candidate_ids: ['event-1', 'event-2'], status: 'conflito' },
      event: { id: 'event-1', transaction_id: 'tx-1' },
    })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'reconciliado_manualmente',
        sumup_transaction_event_id: 'event-1',
        sumup_transaction_id: 'tx-1',
        resolved_by: 'profile-1',
      })
    )
  })

  it('returns 409 and writes nothing when another linked match already claims the same SumUp event', async () => {
    // This is the dedup guard's demotion being undone by a single click: the
    // demoted row's candidate_ids still points at the event the winner holds.
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    const { update, claimIn, claimNeqCalls } = mockAdmin({
      match: { id: MATCH_ID, candidate_ids: ['event-1'], status: 'conflito' },
      event: { id: 'event-1', transaction_id: 'tx-1' },
      existingClaims: [{ id: 'match-winner' }],
    })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toContain('já está vinculado')
    expect(update).not.toHaveBeenCalled()
    // Only auto/manual rows count as a claim — a `rejeitado_manualmente` row's
    // FK is null and must never block a confirm.
    expect(claimIn).toHaveBeenCalledWith('status', [
      'reconciliado_automaticamente',
      'reconciliado_manualmente',
    ])
    // A match can never conflict with itself.
    expect(claimNeqCalls).toEqual([['id', MATCH_ID]])
  })

  it('confirms normally when no other match claims the event', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    const { update } = mockAdmin({
      match: { id: MATCH_ID, candidate_ids: ['event-1'], status: 'conflito' },
      event: { id: 'event-1', transaction_id: 'tx-1' },
      existingClaims: [],
    })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
  })
})
