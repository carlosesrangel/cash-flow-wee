import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageUsers: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock('@/lib/auth/invitation', () => ({ getInvitationRedirectUrl: vi.fn(() => 'https://wee.example/auth/complete?next=%2Fauth%2Fset-password') }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageUsers } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { POST } from '@/app/api/organization/invitations/route'

const MEMBER = { orgId: '00000000-0000-0000-0000-000000000001', profileId: 'owner-1', role: 'OWNER_ADMIN' as const }

function request() {
  return new Request('http://localhost/api/organization/invitations', {
    method: 'POST',
    body: JSON.stringify({ email: 'new.user@example.com', role: 'VIEWER' }),
    headers: { 'content-type': 'application/json' },
  })
}

function buildAdmin(linkResult: { data: unknown; error: unknown }) {
  const invitation = { id: 'invitation-1', email: 'new.user@example.com', role: 'VIEWER', status: 'pending', invited_at: '2026-09-10T00:00:00Z', expires_at: '2026-09-17T00:00:00Z' }
  const insert = vi.fn(() => ({
    select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: invitation, error: null }) })),
  }))
  const linkChain: Record<string, unknown> = {}
  linkChain.eq = vi.fn(() => linkChain)
  linkChain.select = vi.fn(() => ({ single: vi.fn().mockResolvedValue(linkResult) }))
  const cancelChain: Record<string, unknown> = {}
  cancelChain.eq = vi.fn(() => cancelChain)
  const update = vi.fn(() => linkChain)
  const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: 'invited-user' } }, error: null })
  const from = vi.fn((table: string) => {
    if (table !== 'organization_invitations') throw new Error(`unexpected table ${table}`)
    return { insert, update }
  })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from, auth: { admin: { inviteUserByEmail } } } as never)
  return { from, insert, update, invitation }
}

describe('POST /api/organization/invitations', () => {
  afterEach(() => vi.clearAllMocks())

  it('links a pending invitation without activating membership before confirmation', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER)
    vi.mocked(canManageUsers).mockReturnValue(true)
    const { from, invitation } = buildAdmin({ data: { id: 'invitation-1', email: 'new.user@example.com', role: 'VIEWER', status: 'pending', invited_at: '2026-09-10T00:00:00Z', expires_at: '2026-09-17T00:00:00Z', auth_user_id: 'invited-user' }, error: null })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.invitation).toMatchObject({ id: invitation.id, status: 'pending' })
    expect(from).toHaveBeenCalledTimes(2)
    expect(from).not.toHaveBeenCalledWith('organization_members')
  })

  it('cancels the invitation when linking the invited auth user fails', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER)
    vi.mocked(canManageUsers).mockReturnValue(true)
    const { update } = buildAdmin({ data: null, error: { message: 'link failed' } })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'link failed' })
    expect(update).toHaveBeenCalledTimes(2)
  })
})
