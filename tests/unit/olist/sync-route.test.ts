import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageIntegrations: vi.fn(() => true) }))
vi.mock('@/lib/olist/sync', () => ({ runOlistSync: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { runOlistSync } from '@/lib/olist/sync'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

function makeAdminMock(priorSuccessfulRun: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: priorSuccessfulRun, error: null })
  const limit = vi.fn().mockReturnValue({ maybeSingle })
  const eq3 = vi.fn().mockReturnValue({ limit })
  const eq2 = vi.fn().mockReturnValue({ eq: eq3 })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn().mockReturnValue({ select })
  return { from, eq1, eq2, eq3 }
}

describe('POST /api/integracoes/olist/sync', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses initial mode when there is no prior successful sync run', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({
      orgId: ORG_ID,
      profileId: 'profile-1',
      role: 'OWNER_ADMIN',
    } as never)
    const adminMock = makeAdminMock(null)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)
    vi.mocked(runOlistSync).mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/integracoes/olist/sync/route')
    const response = await POST()

    expect(response.status).toBe(200)
    expect(runOlistSync).toHaveBeenCalledWith(ORG_ID, 'initial')
    expect(adminMock.eq1).toHaveBeenCalledWith('org_id', ORG_ID)
    expect(adminMock.eq2).toHaveBeenCalledWith('integration', 'olist')
    expect(adminMock.eq3).toHaveBeenCalledWith('status', 'success')
  })

  it('uses incremental mode when a prior successful sync run exists', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({
      orgId: ORG_ID,
      profileId: 'profile-1',
      role: 'OWNER_ADMIN',
    } as never)
    const adminMock = makeAdminMock({ id: 'run-1' })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)
    vi.mocked(runOlistSync).mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/integracoes/olist/sync/route')
    const response = await POST()

    expect(response.status).toBe(200)
    expect(runOlistSync).toHaveBeenCalledWith(ORG_ID, 'incremental')
  })
})
