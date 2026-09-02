import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { refreshTokens } from '@/lib/olist/oauth'
import { recordExternalFailure } from '@/lib/observability/telemetry'
import { sanitizeIntegrationError } from '@/lib/observability/health'

const API_BASE_URL = 'https://api.tiny.com.br/public-api/v3'
const EXPIRY_BUFFER_MS = 5 * 60 * 1000
const MAX_RETRIES = 3
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504])

// Tiny/Olist enforces a request-per-minute quota by plan (documented at
// ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao):
// 30/min on the "Crescer" plan WEE is on. The quota is per Tiny *account*, shared across every
// app connected to it — not per application — so staying under it here doesn't guarantee a 429
// never happens (another app on the same account can still consume the shared budget), but it
// stops *us* from being the cause. No rate-limit response headers or Retry-After are documented,
// so this is a client-side pre-emptive throttle rather than a reactive one. Configurable via
// OLIST_RATE_LIMIT_PER_MINUTE in case the plan changes; the default leaves headroom below the
// documented ceiling for other apps sharing the account.
const RATE_LIMIT_PER_MINUTE = Number(process.env.OLIST_RATE_LIMIT_PER_MINUTE) || 25
const RATE_LIMIT_WINDOW_MS = 60_000
const requestTimestamps: number[] = []

async function waitForRateLimitSlot(): Promise<void> {
  for (;;) {
    const now = Date.now()
    while (requestTimestamps.length > 0 && now - requestTimestamps[0] >= RATE_LIMIT_WINDOW_MS) {
      requestTimestamps.shift()
    }
    if (requestTimestamps.length < RATE_LIMIT_PER_MINUTE) {
      requestTimestamps.push(now)
      return
    }
    await sleep(RATE_LIMIT_WINDOW_MS - (now - requestTimestamps[0]) + 10)
  }
}

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

// Parses a `Retry-After` header value. Per RFC 9110 it's either a number of seconds
// or an HTTP-date; only the (far more common, and the only one Olist is known to
// send) numeric-seconds form is handled — an HTTP-date or anything unparseable falls
// back to blind exponential backoff.
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds * 1000
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
    await waitForRateLimitSlot()

    const startedAt = Date.now()
    let response: Response
    try {
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      })
    } catch (error) {
      recordExternalFailure({ provider: 'olist', endpoint: url.toString(), startedAt, error })
      throw error
    }

    if (response.ok) {
      return (await response.json()) as T
    }

    const detail = await response.text()
    recordExternalFailure({ provider: 'olist', endpoint: url.toString(), status: response.status, startedAt })
    const safe = sanitizeIntegrationError(String(response.status), detail)
    lastError = new Error(`Olist API request failed (${response.status}) for ${path}: ${safe.message ?? 'upstream error'}`)

    if (response.status === 401) {
      const admin = createAdminSupabaseClient()
      await admin
        .from('integration_connections')
        .update({ status: 'precisa_reautorizar', updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('provider', 'olist')
      throw lastError
    }

    if (!RETRY_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES - 1) {
      throw lastError
    }

    if (response.status === 429) {
      // No Retry-After is documented for this API, and empirically a short exponential
      // backoff isn't enough against a per-minute quota (still lands in the same throttled
      // window) — wait a full window unless the response tells us otherwise.
      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'))
      await sleep(retryAfterMs ?? RATE_LIMIT_WINDOW_MS)
    } else {
      await sleep(2 ** attempt * 500)
    }
  }

  throw lastError ?? new Error(`Olist API request failed for ${path}`)
}
