import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageIntegrations: vi.fn(() => true) }))
vi.mock('@/lib/olist/sync', () => ({ runOlistSync: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { runOlistSync } from '@/lib/olist/sync'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

// Builds a chainable admin mock for `sync_runs` queries. Both hasActiveSyncRun and
// hasPriorSuccessfulSync query the same table with the same eq()/limit()/maybeSingle()
// shape (hasActiveSyncRun additionally chains .gte() before .limit()), so each call to
// `.from('sync_runs')` returns a fresh chain and results are served in call order.
function makeAdminMock(results: Array<Record<string, unknown> | null>) {
  let call = 0
  const from = vi.fn().mockImplementation(() => {
    const data = results[call] ?? null
    call += 1
    const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const gte = vi.fn().mockReturnValue({ limit })
    const eq3 = vi.fn().mockReturnValue({ limit, gte })
    const eq2 = vi.fn().mockReturnValue({ eq: eq3, gte })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    return { select, eq1, eq2, eq3, limit, gte, maybeSingle }
  })
  return { from }
}

describe('POST /api/integracoes/olist/sync', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('uses initial mode when there is no active run and no prior successful sync run', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({
      orgId: ORG_ID,
      profileId: 'profile-1',
      role: 'OWNER_ADMIN',
    } as never)
    const adminMock = makeAdminMock([null, null])
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)
    vi.mocked(runOlistSync).mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/integracoes/olist/sync/route')
    const response = await POST()

    expect(response.status).toBe(200)
    expect(runOlistSync).toHaveBeenCalledWith(ORG_ID, 'initial')
  })

  it('uses incremental mode when no active run exists but a prior successful sync run exists', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({
      orgId: ORG_ID,
      profileId: 'profile-1',
      role: 'OWNER_ADMIN',
    } as never)
    const adminMock = makeAdminMock([null, { id: 'run-1' }])
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)
    vi.mocked(runOlistSync).mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/integracoes/olist/sync/route')
    const response = await POST()

    expect(response.status).toBe(200)
    expect(runOlistSync).toHaveBeenCalledWith(ORG_ID, 'incremental')
  })

  it('returns 409 and does not start a new sync when an active run already exists', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({
      orgId: ORG_ID,
      profileId: 'profile-1',
      role: 'OWNER_ADMIN',
    } as never)
    const adminMock = makeAdminMock([{ id: 'running-run' }])
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)
    vi.mocked(runOlistSync).mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/integracoes/olist/sync/route')
    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual({ error: 'Sincronização já em andamento' })
    expect(runOlistSync).not.toHaveBeenCalled()
  })
})
