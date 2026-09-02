import 'server-only'

export type ExternalFailureClass = 'EXPECTED_4XX' | 'UNEXPECTED_4XX' | 'UPSTREAM_5XX' | 'TIMEOUT' | 'NETWORK'

function endpointPath(endpoint: string): string {
  try { return new URL(endpoint).pathname } catch { return endpoint.split('?')[0].slice(0, 160) }
}

export function classifyExternalFailure(status: number | null, error?: unknown): ExternalFailureClass {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return 'TIMEOUT'
  if (status != null && status >= 500) return 'UPSTREAM_5XX'
  if (status != null && status >= 400 && status < 500) return status === 401 || status === 404 ? 'EXPECTED_4XX' : 'UNEXPECTED_4XX'
  return 'NETWORK'
}

/** Server-side, secret-free request telemetry. It intentionally logs only failures. */
export function recordExternalFailure(input: {
  provider: string
  endpoint: string
  status?: number | null
  startedAt: number
  error?: unknown
}): void {
  const status = input.status ?? null
  console.warn(JSON.stringify({
    event: 'wee.external_request_failure',
    provider: input.provider,
    endpoint: endpointPath(input.endpoint),
    status,
    failure_class: classifyExternalFailure(status, input.error),
    duration_ms: Math.max(0, Date.now() - input.startedAt),
    timestamp: new Date().toISOString(),
  }))
}

