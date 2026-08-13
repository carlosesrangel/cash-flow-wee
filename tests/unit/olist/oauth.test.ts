import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('olist oauth client', () => {
  beforeEach(() => {
    process.env.OLIST_CLIENT_ID = 'test-client-id'
    process.env.OLIST_CLIENT_SECRET = 'test-client-secret'
    process.env.OLIST_REDIRECT_URI = 'http://localhost:3000/integracoes/olist/callback'
    process.env.OLIST_STATE_SECRET = 'test-secret-at-least-32-characters-long'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('builds an authorize URL with the required query params', async () => {
    const { buildAuthorizeUrl } = await import('@/lib/olist/oauth')
    const url = new URL(buildAuthorizeUrl('00000000-0000-0000-0000-000000000001'))
    expect(url.origin + url.pathname).toBe(
      'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth'
    )
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/integracoes/olist/callback'
    )
    expect(url.searchParams.get('scope')).toBe('openid')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('exchanges an authorization code for tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 14400,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { exchangeCodeForTokens } = await import('@/lib/olist/oauth')
    const tokens = await exchangeCodeForTokens('auth-code-abc')

    expect(tokens.accessToken).toBe('access-123')
    expect(tokens.refreshToken).toBe('refresh-456')
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code-abc')
    expect(body.get('client_id')).toBe('test-client-id')
    expect(body.get('client_secret')).toBe('test-client-secret')
  })

  it('throws when the token endpoint returns an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' })
    vi.stubGlobal('fetch', fetchMock)

    const { exchangeCodeForTokens } = await import('@/lib/olist/oauth')
    await expect(exchangeCodeForTokens('bad-code')).rejects.toThrow()
  })

  it('refreshes tokens using grant_type=refresh_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-789',
        refresh_token: 'refresh-000',
        expires_in: 14400,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { refreshTokens } = await import('@/lib/olist/oauth')
    const tokens = await refreshTokens('old-refresh-token')

    expect(tokens.accessToken).toBe('access-789')
    const [, init] = fetchMock.mock.calls[0]
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('old-refresh-token')
  })
})
