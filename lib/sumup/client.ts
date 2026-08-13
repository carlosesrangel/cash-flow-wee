import 'server-only'

const API_BASE_URL = 'https://api.sumup.com'
const MAX_RETRIES = 3
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504])
// Bound a single request so a hung or unresponsive SumUp connection cannot
// block a caller indefinitely (the Integrações page checks status on render).
const REQUEST_TIMEOUT_MS = 15_000
// Upstream error bodies are third-party content of unbounded size; cap them
// before embedding them in an Error message that reaches logs and the UI.
const MAX_ERROR_DETAIL_CHARS = 500

function getApiKey(): string {
  const key = process.env.SUMUP_API_KEY
  if (!key) throw new Error('SUMUP_API_KEY must be set')
  return key
}

export function getSumupMerchantCode(): string {
  const code = process.env.SUMUP_MERCHANT_CODE
  if (!code) throw new Error('SUMUP_MERCHANT_CODE must be set')
  return code
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds * 1000
}

export async function sumupFetch<T>(
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${getApiKey()}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (response.ok) {
      return (await response.json()) as T
    }

    const detail = (await response.text()).slice(0, MAX_ERROR_DETAIL_CHARS)
    lastError = new Error(`SumUp API request failed (${response.status}) for ${path}: ${detail}`)

    if (!RETRY_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES - 1) {
      throw lastError
    }

    const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers.get('Retry-After')) : null
    await sleep(retryAfterMs ?? 2 ** attempt * 500)
  }

  throw lastError ?? new Error(`SumUp API request failed for ${path}`)
}
