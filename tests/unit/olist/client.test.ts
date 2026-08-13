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

function makeUpdateMock() {
  const updateEq2 = vi.fn().mockResolvedValue({ error: null })
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
  const update = vi.fn().mockReturnValue({ eq: updateEq1 })
  return { update, updateEq1, updateEq2 }
}

function makeAdminMock(connectionRow: Record<string, unknown> | null) {
  const { update, updateEq1, updateEq2 } = makeUpdateMock()
  const single = vi.fn().mockResolvedValue({ data: connectionRow, error: null })
  const eq2 = vi.fn().mockReturnValue({ single })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn().mockReturnValue({ select, update })
  return { from, updateEq1, updateEq2 }
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
    expect(adminMock.updateEq1).toHaveBeenCalledWith('org_id', ORG_ID)
    expect(adminMock.updateEq2).toHaveBeenCalledWith('provider', 'olist')
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

  it('throws when persisting the refreshed tokens fails', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const updateEq2 = vi.fn().mockResolvedValue({ error: { message: 'db down' } })
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
    const update = vi.fn().mockReturnValue({ eq: updateEq1 })
    const single = vi.fn().mockResolvedValue({
      data: {
        access_token: 'old-token',
        refresh_token: 'refresh-token',
        expires_at: nearExpiry,
        status: 'conectado',
      },
      error: null,
    })
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select, update })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
    vi.mocked(refreshTokens).mockResolvedValue({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    })

    const { getValidConnection } = await import('@/lib/olist/client')

    await expect(getValidConnection(ORG_ID)).rejects.toThrow(/db down/)

    expect(updateEq1).toHaveBeenCalledWith('org_id', ORG_ID)
    expect(updateEq2).toHaveBeenCalledWith('provider', 'olist')
  })

  it('throws when marking precisa_reautorizar fails after a refresh failure', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const updateEq2 = vi.fn().mockResolvedValue({ error: { message: 'db down' } })
    const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
    const update = vi.fn().mockReturnValue({ eq: updateEq1 })
    const single = vi.fn().mockResolvedValue({
      data: {
        access_token: 'old-token',
        refresh_token: 'expired-refresh-token',
        expires_at: nearExpiry,
        status: 'conectado',
      },
      error: null,
    })
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select, update })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
    vi.mocked(refreshTokens).mockRejectedValue(new Error('invalid_grant'))

    const { getValidConnection } = await import('@/lib/olist/client')

    await expect(getValidConnection(ORG_ID)).rejects.toThrow(/db down/)

    expect(updateEq1).toHaveBeenCalledWith('org_id', ORG_ID)
    expect(updateEq2).toHaveBeenCalledWith('provider', 'olist')
  })

  it('shares one in-flight refresh across concurrent calls for the same org', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'old-token',
      refresh_token: 'refresh-token',
      expires_at: nearExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

    let resolveRefresh!: (value: {
      accessToken: string
      refreshToken: string
      expiresAt: Date
    }) => void
    vi.mocked(refreshTokens).mockClear()
    vi.mocked(refreshTokens).mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve
      })
    )

    const { getValidConnection } = await import('@/lib/olist/client')

    const call1 = getValidConnection(ORG_ID)
    const call2 = getValidConnection(ORG_ID)

    resolveRefresh({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    })

    const [result1, result2] = await Promise.all([call1, call2])

    expect(result1).toEqual({ accessToken: 'new-token' })
    expect(result2).toEqual({ accessToken: 'new-token' })
    expect(refreshTokens).toHaveBeenCalledTimes(1)
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
