export const VERIFIED_RECONCILIATION_CLASSIFICATIONS = new Set(['VERIFIED_EXACT', 'VERIFIED_COMPOSITE'])

export function isVerifiedReconciliation(match: { status?: string | null; match_reason?: Record<string, unknown> | null } | null | undefined): boolean {
  if (!match || !['reconciliado_automaticamente', 'reconciliado_manualmente'].includes(String(match.status ?? ''))) return false
  return VERIFIED_RECONCILIATION_CLASSIFICATIONS.has(String(match.match_reason?.v2_classification ?? ''))
}
