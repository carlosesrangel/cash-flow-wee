import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageIntegrations: vi.fn() }))
vi.mock('@/lib/sumup/sync/index', () => ({ runSumupSync: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { runSumupSync } from '@/lib/sumup/sync/index'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'OWNER_ADMIN' as const }

function mockSyncRunsQuery(result: { data: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const limit = vi.fn().mockReturnValue({ maybeSingle })
  const gte = vi.fn().mockReturnValue({ limit, maybeSingle })
  const eq2 = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ limit, maybeSingle, gte }) })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { from: vi.fn().mockReturnValue({ select }) }
}

describe('POST /api/integracoes/sumup/sync', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()

    expect(response.status).toBe(403)
    expect(runSumupSync).not.toHaveBeenCalled()
  })

  it('returns 403 when the member lacks canManageIntegrations', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canManageIntegrations).mockReturnValue(false)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()

    expect(response.status).toBe(403)
    expect(runSumupSync).not.toHaveBeenCalled()
  })

  it('returns 409 when a sync is already running', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageIntegrations).mockReturnValue(true)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSyncRunsQuery({ data: { id: 'active-run' } }) as never)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()

    expect(response.status).toBe(409)
    expect(runSumupSync).not.toHaveBeenCalled()
  })

  it('calls runSumupSync in initial mode when no prior successful run exists, returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageIntegrations).mockReturnValue(true)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSyncRunsQuery({ data: null }) as never)
    vi.mocked(runSumupSync).mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(runSumupSync).toHaveBeenCalledWith(ORG_ID, 'initial')
  })
})
