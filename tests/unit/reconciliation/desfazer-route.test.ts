import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageReconciliation: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'OWNER_ADMIN' as const }
const MATCH_ID = 'match-1'

function buildRequest() {
  return new Request(`http://localhost/api/reconciliacao/${MATCH_ID}/desfazer`, { method: 'POST' })
}

function ctx() {
  return { params: Promise.resolve({ id: MATCH_ID }) }
}

function mockAdmin(options: { match?: { id: string } | null; updateError?: { message: string } | null }) {
  const matchMaybeSingle = vi.fn().mockResolvedValue({ data: options.match ?? null, error: null })
  const matchEq2 = vi.fn().mockReturnValue({ maybeSingle: matchMaybeSingle })
  const matchEq1 = vi.fn().mockReturnValue({ eq: matchEq2 })
  const matchSelect = vi.fn().mockReturnValue({ eq: matchEq1 })

  const updateEq2 = vi.fn().mockResolvedValue({ error: options.updateError ?? null })
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
  const update = vi.fn().mockReturnValue({ eq: updateEq1 })

  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_matches') return { select: matchSelect, update }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { update }
}

describe('POST /api/reconciliacao/[id]/desfazer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    const response = await POST(buildRequest(), ctx())

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canManageReconciliation', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canManageReconciliation).mockReturnValue(false)

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    const response = await POST(buildRequest(), ctx())

    expect(response.status).toBe(403)
  })

  it('returns 404 when the match does not exist in the caller org', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    mockAdmin({ match: null })

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    const response = await POST(buildRequest(), ctx())

    expect(response.status).toBe(404)
  })

  it('resets the match to nao_reconciliado and returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    const { update } = mockAdmin({ match: { id: MATCH_ID } })

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    const response = await POST(buildRequest(), ctx())
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'nao_reconciliado',
        sumup_transaction_event_id: null,
        sumup_transaction_id: null,
        resolved_by: null,
        resolved_at: null,
      })
    )
  })
})
