import { signState } from '@/lib/olist/state'

const AUTHORIZE_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth'
const TOKEN_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token'

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
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Olist token request failed (${response.status}): ${detail}`)
  }

  const data = await response.json()
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
