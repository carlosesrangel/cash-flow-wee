import { describe, expect, it } from 'vitest'
import { classifyFreshness, deriveIntegrationHealth, evaluateHealthChecks, sanitizeIntegrationError } from '@/lib/observability/health'

const now = new Date('2026-09-02T12:00:00.000Z')

describe('integration health and freshness', () => {
  it('uses centralized daily-job thresholds', () => {
    expect(classifyFreshness('2026-09-02T00:00:00.000Z', now)).toBe('FRESH')
    expect(classifyFreshness('2026-08-31T00:00:00.000Z', now)).toBe('WARNING')
    expect(classifyFreshness('2026-08-29T00:00:00.000Z', now)).toBe('STALE')
    expect(classifyFreshness('2026-08-24T00:00:00.000Z', now)).toBe('CRITICAL')
  })

  it('keeps OAuth reauthorization explicit even when persisted data exists', () => {
    const health = deriveIntegrationHealth({
      provider: 'olist',
      connectionStatus: 'precisa_reautorizar',
      now,
      runs: [{ integration: 'olist', status: 'success', started_at: '2026-09-01T00:00:00.000Z', finished_at: '2026-09-01T00:10:00.000Z', records_received: 411, records_created: null, records_updated: null, error_count: 0, error_message: null }],
    })
    expect(health.status).toBe('AUTH_REQUIRED')
    expect(health.authenticated).toBe(false)
    expect(health.recordsReceived).toBe(411)
  })

  it('sanitizes token-like error material without hiding the HTTP class', () => {
    expect(sanitizeIntegrationError(null, '401 unauthorized Bearer abc123 refresh_token=secret')).toEqual({ code: '401', message: '401 unauthorized Bearer [redacted] refresh_token=[redacted]' })
  })
})

describe('automated financial and fiscal health checks', () => {
  it('passes only when every invariant is within tolerance', () => {
    const checks = evaluateHealthChecks({ signedBridgeDifference: 0.01, unexplainedResidual: 0, missingSemanticReceivables: 0, duplicateSemanticEvents: 0, unexpectedMissingDataFaturamento: 0 })
    expect(checks.every((check) => check.status === 'PASS')).toBe(true)
  })

  it('records a failing invariant instead of repairing data silently', () => {
    const checks = evaluateHealthChecks({ signedBridgeDifference: 0, unexplainedResidual: 12.5, missingSemanticReceivables: 0, duplicateSemanticEvents: 0, unexpectedMissingDataFaturamento: 1 })
    expect(checks.find((check) => check.key === 'UNEXPLAINED_RESIDUAL')?.status).toBe('FAIL')
    expect(checks.find((check) => check.key === 'UNEXPECTED_MISSING_DATA_FATURAMENTO')?.status).toBe('FAIL')
  })
})

