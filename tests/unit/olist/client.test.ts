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
    // Reset the module cache so each test's requestTimestamps (rate-limiter state) starts
    // empty — otherwise timestamps accumulate across tests in this file and could eventually
    // exhaust the budget and force a real 60s+ wait instead of failing cleanly.
    vi.resetModules()
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

  it('honors a numeric Retry-After header on a 429 instead of blind exponential backoff', async () => {
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
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
        headers: new Headers({ 'Retry-After': '2' }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const { olistFetch } = await import('@/lib/olist/client')
    const result = await olistFetch<{ ok: boolean }>(ORG_ID, '/contatos', {})

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000)
  })

  it('waits a full rate-limit window on a 429 with no Retry-After header', async () => {
    // A short exponential backoff isn't enough against a per-minute quota — it still lands
    // in the same throttled window (this is exactly what happened against the real API).
    // With no Retry-After to go by, wait a full window (60s) instead.
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
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited', headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    // Fires the callback immediately instead of actually waiting 60s of real time —
    // this test only needs to prove the correct delay was requested, not experience it.
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((fn: () => void) => {
        fn()
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout)

    const { olistFetch } = await import('@/lib/olist/client')
    const result = await olistFetch<{ ok: boolean }>(ORG_ID, '/contatos', {})

    expect(result).toEqual({ ok: true })
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60_000)
  })

  it('still uses exponential backoff for non-429 retryable statuses', async () => {
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
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const { olistFetch } = await import('@/lib/olist/client')
    const result = await olistFetch<{ ok: boolean }>(ORG_ID, '/contatos', {})

    expect(result).toEqual({ ok: true })
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500)
  })

  it('self-throttles to stay under the requests-per-minute budget', async () => {
    // Fake timers here (not the immediate-fire setTimeout mock used above): the limiter's
    // wait loop re-reads Date.now() on each pass, so a mock that resolves sleep() instantly
    // without advancing the clock makes it spin forever recomputing the same "still not
    // enough time passed" result. Fake timers advance Date consistently with the clock,
    // so the loop naturally exits once enough (virtual) time has elapsed.
    vi.resetModules()
    vi.useFakeTimers()
    try {
      const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      const adminMock = makeAdminMock({
        access_token: 'valid-token',
        refresh_token: 'refresh-token',
        expires_at: futureExpiry,
        status: 'conectado',
      })
      vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
      vi.stubGlobal('fetch', fetchMock)

      process.env.OLIST_RATE_LIMIT_PER_MINUTE = '3'
      const { olistFetch } = await import('@/lib/olist/client')

      // First 3 calls consume the whole budget and must not wait.
      await olistFetch(ORG_ID, '/contatos', {})
      await olistFetch(ORG_ID, '/contatos', {})
      await olistFetch(ORG_ID, '/contatos', {})
      expect(fetchMock).toHaveBeenCalledTimes(3)

      // The 4th call is over budget — it must wait for the oldest slot to age out of the 60s
      // window before firing (a small buffer is added on top, see waitForRateLimitSlot).
      const fourthCall = olistFetch(ORG_ID, '/contatos', {})
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(3)

      await vi.advanceTimersByTimeAsync(61_000)
      await fourthCall
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally {
      delete process.env.OLIST_RATE_LIMIT_PER_MINUTE
      vi.useRealTimers()
      // The cached module instance has RATE_LIMIT_PER_MINUTE=3 baked in, and its
      // requestTimestamps entries were recorded on the fake clock — comparing them against
      // real Date.now() afterward could read as "in the future" and never age out. Reset so
      // later tests import a clean module under the default limit and real time.
      vi.resetModules()
    }
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
