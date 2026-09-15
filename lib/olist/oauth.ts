import 'server-only'
import { signState } from '@/lib/olist/state'
import { recordExternalFailure } from '@/lib/observability/telemetry'

const AUTHORIZE_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth'
const TOKEN_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token'
const TOKEN_REQUEST_TIMEOUT_MS = 15_000

export class OAuthTokenError extends Error {
  constructor(public readonly oauthCode: string, status: number) { super(`Olist token request failed (${status}): ${oauthCode}`) }
}

export type OlistTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

function getEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set`)
  return value
}

export function buildAuthorizeUrl(orgId: string): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', getEnv('OLIST_CLIENT_ID'))
  url.searchParams.set('redirect_uri', getEnv('OLIST_REDIRECT_URI'))
  url.searchParams.set('scope', 'openid')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', signState({ orgId }))
  return url.toString()
}

async function requestTokens(body: URLSearchParams): Promise<OlistTokens> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    })
  } catch (error) {
    recordExternalFailure({ provider: 'olist-oauth', endpoint: TOKEN_URL, startedAt, error })
    throw new Error(`Olist token request network failure: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    recordExternalFailure({ provider: 'olist-oauth', endpoint: TOKEN_URL, status: response.status, startedAt })
    const body = await response.json().catch(() => ({}))
    const code = ['invalid_grant', 'invalid_client', 'temporarily_unavailable'].includes(body.error) ? body.error : 'upstream_error'
    throw new OAuthTokenError(code, response.status)
  }

  const data = await response.json()
  if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('Invalid Olist token response')
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

export async function exchangeCodeForTokens(code: string): Promise<OlistTokens> {
  return requestTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: getEnv('OLIST_CLIENT_ID'),
      client_secret: getEnv('OLIST_CLIENT_SECRET'),
      redirect_uri: getEnv('OLIST_REDIRECT_URI'),
      code,
    })
  )
}

export async function refreshTokens(refreshToken: string): Promise<OlistTokens> {
  return requestTokens(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: getEnv('OLIST_CLIENT_ID'),
      client_secret: getEnv('OLIST_CLIENT_SECRET'),
      refresh_token: refreshToken,
    })
  )
}
