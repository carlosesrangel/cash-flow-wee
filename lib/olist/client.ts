import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { refreshTokens } from '@/lib/olist/oauth'

const API_BASE_URL = 'https://api.tiny.com.br/public-api/v3'
const EXPIRY_BUFFER_MS = 5 * 60 * 1000
const MAX_RETRIES = 3
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504])

// Single-flight cache: concurrent getValidConnection calls for the same org share one
// in-flight refresh instead of each independently calling refreshTokens(). This matters
// because Olist may rotate/invalidate the refresh token on use — two simultaneous refreshes
// with the same stale refresh_token would otherwise cause the second call to fail with
// invalid_grant even though the first succeeded moments earlier.
const inFlightConnections = new Map<string, Promise<{ accessToken: string } | null>>()

export function getValidConnection(orgId: string): Promise<{ accessToken: string } | null> {
  const existing = inFlightConnections.get(orgId)
  if (existing) {
    return existing
  }

  const promise = fetchValidConnection(orgId).finally(() => {
    inFlightConnections.delete(orgId)
  })
  inFlightConnections.set(orgId, promise)

  return promise
}

async function fetchValidConnection(orgId: string): Promise<{ accessToken: string } | null> {
  const admin = createAdminSupabaseClient()
  const { data: connection } = await admin
    .from('integration_connections')
    .select('access_token, refresh_token, expires_at, status')
    .eq('org_id', orgId)
    .eq('provider', 'olist')
    .single()

  if (!connection || !connection.access_token || !connection.refresh_token) {
    return null
  }

  const expiresAt = connection.expires_at ? new Date(connection.expires_at as string).getTime() : 0
  const needsRefresh = expiresAt - Date.now() < EXPIRY_BUFFER_MS

  if (!needsRefresh) {
    return { accessToken: connection.access_token as string }
  }

  let tokens
  try {
    tokens = await refreshTokens(connection.refresh_token as string)
  } catch {
    const { error } = await admin
      .from('integration_connections')
      .update({ status: 'precisa_reautorizar', updated_at: new Date().toISOString() })
      .eq('org_id', orgId)
      .eq('provider', 'olist')

    if (error) {
      throw new Error(`Falha ao marcar conexão Olist como precisa_reautorizar: ${error.message}`)
    }

    return null
  }

  const { error } = await admin
    .from('integration_connections')
    .update({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt.toISOString(),
      status: 'conectado',
      updated_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('provider', 'olist')

  if (error) {
    throw new Error(`Falha ao persistir tokens renovados da Olist: ${error.message}`)
  }

  return { accessToken: tokens.accessToken }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function olistFetch<T>(
  orgId: string,
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const connection = await getValidConnection(orgId)
  if (!connection) {
    throw new Error(`Olist connection unavailable for org ${orgId} — reauthorization required`)
  }

  const url = new URL(`${API_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${connection.accessToken}` },
    })

    if (response.ok) {
      return (await response.json()) as T
    }

    const detail = await response.text()
    lastError = new Error(`Olist API request failed (${response.status}) for ${path}: ${detail}`)

    if (!RETRY_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES - 1) {
      throw lastError
    }

    await sleep(2 ** attempt * 500)
  }

  throw lastError ?? new Error(`Olist API request failed for ${path}`)
}
