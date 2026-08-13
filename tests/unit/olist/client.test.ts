import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))
vi.mock('@/lib/olist/oauth', () => ({
  refreshTokens: vi.fn(),
}))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { refreshTokens } from '@/lib/olist/oauth'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

function makeAdminMock(connectionRow: Record<string, unknown> | null) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  const single = vi.fn().mockResolvedValue({ data: connectionRow, error: null })
  const eq2 = vi.fn().mockReturnValue({ single })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn().mockReturnValue({ select, update })
  return { from }
}

describe('getValidConnection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the access token unchanged when not near expiry', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'valid-token',
      refresh_token: 'refresh-token',
      expires_at: futureExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

    const { getValidConnection } = await import('@/lib/olist/client')
    const result = await getValidConnection(ORG_ID)

    expect(result).toEqual({ accessToken: 'valid-token' })
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it('refreshes and returns the new token when near expiry', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'old-token',
      refresh_token: 'refresh-token',
      expires_at: nearExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)
    vi.mocked(refreshTokens).mockResolvedValue({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    })

    const { getValidConnection } = await import('@/lib/olist/client')
    const result = await getValidConnection(ORG_ID)

    expect(result).toEqual({ accessToken: 'new-token' })
    expect(refreshTokens).toHaveBeenCalledWith('refresh-token')
  })

  it('returns null and does not throw when refresh fails (refresh token expired)', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'old-token',
      refresh_token: 'expired-refresh-token',
      expires_at: nearExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)
    vi.mocked(refreshTokens).mockRejectedValue(new Error('invalid_grant'))

    const { getValidConnection } = await import('@/lib/olist/client')
    const result = await getValidConnection(ORG_ID)

    expect(result).toBeNull()
  })

  it('returns null when there is no connection row', async () => {
    const adminMock = makeAdminMock(null)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

    const { getValidConnection } = await import('@/lib/olist/client')
    const result = await getValidConnection(ORG_ID)

    expect(result).toBeNull()
  })
})

describe('olistFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries once on a 5xx response then succeeds', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'valid-token',
      refresh_token: 'refresh-token',
      expires_at: futureExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const { olistFetch } = await import('@/lib/olist/client')
    const result = await olistFetch<{ ok: boolean }>(ORG_ID, '/contatos', { limit: 100, offset: 0 })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting retries', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'valid-token',
      refresh_token: 'refresh-token',
      expires_at: futureExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'error' })
    vi.stubGlobal('fetch', fetchMock)

    const { olistFetch } = await import('@/lib/olist/client')
    await expect(olistFetch(ORG_ID, '/contatos', {})).rejects.toThrow()
  })
})
