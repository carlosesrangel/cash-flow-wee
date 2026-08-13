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

/**
 * The route runs two `sync_runs` queries whose chains differ only by a `.gte()`
 * (the active-run check filters on `started_at`; the prior-success check does
 * not), so the mock forks there instead of returning the same row for both —
 * otherwise the `incremental` branch is unreachable from a test.
 */
function mockSyncRunsQuery(options: { activeRun?: unknown; priorSuccess?: unknown } = {}) {
  const priorSuccessMaybeSingle = vi.fn().mockResolvedValue({ data: options.priorSuccess ?? null })
  const activeRunMaybeSingle = vi.fn().mockResolvedValue({ data: options.activeRun ?? null })

  const priorSuccessLimit = vi.fn().mockReturnValue({ maybeSingle: priorSuccessMaybeSingle })
  const activeRunLimit = vi.fn().mockReturnValue({ maybeSingle: activeRunMaybeSingle })

  const gte = vi.fn().mockReturnValue({ limit: activeRunLimit, maybeSingle: activeRunMaybeSingle })
  const eq3 = vi.fn().mockReturnValue({
    limit: priorSuccessLimit,
    maybeSingle: priorSuccessMaybeSingle,
    gte,
  })
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 })
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
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSyncRunsQuery({ activeRun: { id: 'active-run' } }) as never)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()

    expect(response.status).toBe(409)
    expect(runSumupSync).not.toHaveBeenCalled()
  })

  it('calls runSumupSync in initial mode when no prior successful run exists, returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageIntegrations).mockReturnValue(true)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSyncRunsQuery() as never)
    vi.mocked(runSumupSync).mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(runSumupSync).toHaveBeenCalledWith(ORG_ID, 'initial')
  })

  it('calls runSumupSync in incremental mode when a prior successful run exists', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageIntegrations).mockReturnValue(true)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(
      mockSyncRunsQuery({ priorSuccess: { id: 'previous-successful-run' } }) as never
    )
    vi.mocked(runSumupSync).mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(runSumupSync).toHaveBeenCalledWith(ORG_ID, 'incremental')
  })

  it('returns 500 with the failure message when the sync throws', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageIntegrations).mockReturnValue(true)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSyncRunsQuery() as never)
    vi.mocked(runSumupSync).mockRejectedValue(new Error('sync boom'))

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ ok: false, error: 'sync boom' })
  })
})
