export const INTEGRATION_HEALTH_THRESHOLDS = {
  // The scheduled jobs run daily. A 12-hour grace period avoids false alarms
  // around the 02:00/03:00 UTC window while still surfacing a missed run.
  expectedSyncFrequencyHours: 24,
  warningAfterHours: 36,
  staleAfterHours: 72,
  criticalAfterHours: 168,
} as const

export type FreshnessLevel = 'FRESH' | 'WARNING' | 'STALE' | 'CRITICAL'
export type IntegrationHealthStatus = 'HEALTHY' | 'STALE' | 'DEGRADED' | 'AUTH_REQUIRED' | 'FAILED' | 'NEVER_SYNCED'

export type HealthSyncRun = {
  integration: 'olist' | 'sumup' | 'analytics' | 'ledger'
  status: 'running' | 'success' | 'failed'
  started_at: string
  finished_at: string | null
  records_received: number | null
  records_created: number | null
  records_updated: number | null
  error_count: number | null
  error_message: string | null
}

export type IntegrationHealth = {
  provider: 'olist' | 'sumup' | 'analytics' | 'ledger'
  status: IntegrationHealthStatus
  authenticated: boolean | null
  lastSuccessfulSyncAt: string | null
  lastAttemptAt: string | null
  lastFailureAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  recordsReceived: number | null
  recordsCreated: number | null
  recordsUpdated: number | null
  recordsSkipped: number | null
  syncDurationMs: number | null
  freshness: FreshnessLevel
  freshnessAgeHours: number | null
  expectedSyncFrequencyHours: number
}

export function ageInHours(timestamp: string | null | undefined, now = new Date()): number | null {
  if (!timestamp) return null
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, (now.getTime() - parsed) / 3_600_000)
}

export function classifyFreshness(
  timestamp: string | null | undefined,
  now = new Date(),
  thresholds = INTEGRATION_HEALTH_THRESHOLDS,
): FreshnessLevel {
  const age = ageInHours(timestamp, now)
  if (age == null) return 'CRITICAL'
  if (age <= thresholds.warningAfterHours) return 'FRESH'
  if (age <= thresholds.staleAfterHours) return 'WARNING'
  if (age <= thresholds.criticalAfterHours) return 'STALE'
  return 'CRITICAL'
}

export function sanitizeIntegrationError(errorCode: unknown, message: unknown): { code: string | null; message: string | null } {
  const source = String(message ?? '').trim()
  const code = String(errorCode ?? '').trim() || (source.match(/\b(4\d{2}|5\d{2})\b/)?.[1] ?? null)
  if (!source) return { code, message: null }
  const sanitized = source
    .replace(/bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/(access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[url redacted]')
    .slice(0, 240)
  return { code, message: sanitized }
}

export function deriveIntegrationHealth(input: {
  provider: IntegrationHealth['provider']
  runs: HealthSyncRun[]
  connectionStatus?: 'desconectado' | 'conectado' | 'precisa_reautorizar' | null
  now?: Date
}): IntegrationHealth {
  const now = input.now ?? new Date()
  const runs = [...input.runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
  const latest = runs[0] ?? null
  const latestSuccess = runs.find((run) => run.status === 'success' && run.finished_at) ?? null
  const latestFailure = runs.find((run) => run.status === 'failed' && run.finished_at) ?? null
  const freshnessAt = latestSuccess?.finished_at ?? null
  const freshness = classifyFreshness(freshnessAt, now)
  const error = sanitizeIntegrationError(null, latestFailure?.error_message)
  const status: IntegrationHealthStatus = input.connectionStatus === 'precisa_reautorizar'
    ? 'AUTH_REQUIRED'
    : latest?.status === 'failed' && !latestSuccess
      ? 'FAILED'
      : !latestSuccess
        ? 'NEVER_SYNCED'
        : latest?.status === 'failed'
          ? 'DEGRADED'
          : freshness === 'STALE' || freshness === 'CRITICAL'
            ? 'STALE'
            : 'HEALTHY'
  const received = latestSuccess?.records_received ?? null
  const created = latestSuccess?.records_created ?? null
  const updated = latestSuccess?.records_updated ?? null
  const skipped = received != null && created != null && updated != null
    ? Math.max(received - created - updated, 0)
    : null
  const duration = latestSuccess?.finished_at
    ? Math.max(0, Date.parse(latestSuccess.finished_at) - Date.parse(latestSuccess.started_at))
    : null
  return {
    provider: input.provider,
    status,
    authenticated: input.connectionStatus == null ? null : input.connectionStatus === 'conectado',
    lastSuccessfulSyncAt: latestSuccess?.finished_at ?? null,
    lastAttemptAt: latest?.started_at ?? null,
    lastFailureAt: latestFailure?.finished_at ?? null,
    lastErrorCode: error.code,
    lastErrorMessage: error.message,
    recordsReceived: received,
    recordsCreated: created,
    recordsUpdated: updated,
    recordsSkipped: skipped,
    syncDurationMs: duration,
    freshness,
    freshnessAgeHours: ageInHours(freshnessAt, now),
    expectedSyncFrequencyHours: INTEGRATION_HEALTH_THRESHOLDS.expectedSyncFrequencyHours,
  }
}

export type HealthCheck = {
  key: 'SIGNED_BRIDGE_DIFFERENCE' | 'UNEXPLAINED_RESIDUAL' | 'MISSING_SEMANTIC_RECEIVABLES' | 'DUPLICATE_SEMANTIC_EVENTS' | 'UNEXPECTED_MISSING_DATA_FATURAMENTO'
  value: number
  expected: number
  status: 'PASS' | 'FAIL'
}

export type OperationalAlert = { severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL'; key: string; message: string }

export function buildOperationalAlerts(input: { integrations: IntegrationHealth[]; checks: HealthCheck[]; legacyMatches: number; ambiguousMatches: number }): OperationalAlert[] {
  const alerts: OperationalAlert[] = []
  for (const integration of input.integrations) {
    if (integration.status === 'AUTH_REQUIRED') alerts.push({ severity: 'HIGH', key: `${integration.provider}_AUTH_REQUIRED`, message: `${integration.provider} requer reautorização; dados persistidos permanecem disponíveis.` })
    else if (integration.status === 'FAILED') alerts.push({ severity: 'HIGH', key: `${integration.provider}_SYNC_FAILED`, message: `${integration.provider} não possui sincronização bem-sucedida disponível.` })
    else if (integration.freshness === 'CRITICAL') alerts.push({ severity: 'HIGH', key: `${integration.provider}_CRITICAL_FRESHNESS`, message: `${integration.provider} está além da janela crítica de atualização.` })
    else if (integration.freshness === 'STALE') alerts.push({ severity: 'WARNING', key: `${integration.provider}_STALE`, message: `${integration.provider} está stale e precisa de confirmação operacional.` })
  }
  for (const check of input.checks.filter((item) => item.status === 'FAIL')) alerts.push({ severity: 'CRITICAL', key: check.key, message: `${check.key} saiu do valor esperado (${check.value}).` })
  if (input.legacyMatches > 0 || input.ambiguousMatches > 0) alerts.push({ severity: 'INFO', key: 'MATCH_QUALITY_DEBT', message: `${input.legacyMatches} matches legados e ${input.ambiguousMatches} ambíguos permanecem sem força probatória.` })
  return alerts
}

export function evaluateHealthChecks(values: {
  signedBridgeDifference: number
  unexplainedResidual: number
  missingSemanticReceivables: number
  duplicateSemanticEvents: number
  unexpectedMissingDataFaturamento: number
}): HealthCheck[] {
  return [
    ['SIGNED_BRIDGE_DIFFERENCE', values.signedBridgeDifference],
    ['UNEXPLAINED_RESIDUAL', values.unexplainedResidual],
    ['MISSING_SEMANTIC_RECEIVABLES', values.missingSemanticReceivables],
    ['DUPLICATE_SEMANTIC_EVENTS', values.duplicateSemanticEvents],
    ['UNEXPECTED_MISSING_DATA_FATURAMENTO', values.unexpectedMissingDataFaturamento],
  ].map(([key, value]) => ({ key: key as HealthCheck['key'], value: Number(value), expected: 0, status: Math.abs(Number(value)) <= 0.01 ? 'PASS' : 'FAIL' }))
}
