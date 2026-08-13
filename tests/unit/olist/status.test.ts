import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('getOlistConnectionStatus', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns desconectado when there is no connection row', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { getOlistConnectionStatus } = await import('@/lib/olist/status')
    const result = await getOlistConnectionStatus(ORG_ID)

    expect(result).toEqual({ status: 'desconectado', connectedAt: null })
  })

  it('returns the stored status and connectedAt, never the tokens', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { status: 'conectado', connected_at: '2026-08-12T00:00:00Z' },
      error: null,
    })
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { getOlistConnectionStatus } = await import('@/lib/olist/status')
    const result = await getOlistConnectionStatus(ORG_ID)

    expect(result).toEqual({ status: 'conectado', connectedAt: '2026-08-12T00:00:00Z' })
    expect(select).toHaveBeenCalledWith('status, connected_at')
  })
})
