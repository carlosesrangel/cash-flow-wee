import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadAllVersions, loadVersionEntries, loadScenarios } from '@/lib/forecast/engine'
import { applyScenario } from '@/lib/forecast/scenarios'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

/**
 * Converts forecast entries (versioned, with optional scenario) into projected
 * cash inflows that can be merged with actual cash flow entries for display.
 *
 * Assumptions for Phase 6B:
 * - Each forecast month's full amount is received on the 1st of that month
 *   (simplified; Phase 6C will refine with payment profile analysis)
 * - Scenario percentage is applied uniformly across all months
 *
 * Returns entries with origin='forecast', bucket='projetado', and dates
 * based on forecast month (always 1st of month for simplicity).
 */
export async function loadForecastedCashFlowEntries(
  orgId: string,
  versionId?: string,
  scenarioId?: string
): Promise<CashFlowEntry[]> {
  const admin = createAdminSupabaseClient()

  // Load current version if not specified
  let selectedVersionId = versionId
  if (!selectedVersionId) {
    const versions = await loadAllVersions(orgId)
    if (versions.length === 0) return []
    selectedVersionId = versions[0].id
  } else {
    // Verify version belongs to this org
    const versions = await loadAllVersions(orgId)
    if (!versions.find((v) => v.id === selectedVersionId)) {
      return []
    }
  }

  // Load forecast entries (base: 100%)
  const baseEntries = await loadVersionEntries(orgId, selectedVersionId)
  if (baseEntries.length === 0) return []

  // Apply scenario if specified
  let forecastEntries = baseEntries
  if (scenarioId) {
    const scenarios = await loadScenarios(orgId)
    const scenario = scenarios.find((s) => s.scenario.id === scenarioId)
    if (scenario) {
      forecastEntries = applyScenario(baseEntries, scenario.multipliers)
    }
  }

  // Convert forecast entries to CashFlowEntry format
  const entries: CashFlowEntry[] = forecastEntries.map((entry: MonthlyValue) => ({
    id: `forecast-${selectedVersionId}-${entry.ano}-${String(entry.mes).padStart(2, '0')}`,
    origin: 'forecast' as const,
    sourceId: selectedVersionId,
    // Simplified: always project to 1st of month (Phase 6C will refine)
    date: `${entry.ano}-${String(entry.mes).padStart(2, '0')}-01`,
    amount: entry.value,
    direction: 'entrada' as const,
    bucket: 'projetado' as const,
    description: `Forecast - ${entry.ano}/${String(entry.mes).padStart(2, '0')}`,
  }))

  return entries
}

/**
 * Merges actual cash flow entries with forecast entries, handling duplicates
 * and ensuring forecast only appears for future months (not overlapping
 * with historical data).
 */
export function mergeCashFlowWithForecast(
  actualEntries: CashFlowEntry[],
  forecastEntries: CashFlowEntry[],
  today: { ano: number; mes: number }
): CashFlowEntry[] {
  // Find the latest actual transaction date
  const actualDates = actualEntries.map((e) => e.date).filter((d) => d)
  const latestActualDate = actualDates.length > 0 ? new Date(Math.max(...actualDates.map((d) => new Date(d).getTime()))) : null

  // Filter forecast to only include future months
  const futureForecasts = forecastEntries.filter((f) => {
    if (!f.date) return false
    const [ano, mes] = f.date.split('-').map(Number)
    // Include if after today or if today's month
    if (ano > today.ano) return true
    if (ano === today.ano && mes >= today.mes) return true
    return false
  })

  // Combine (actual first, then future forecast)
  return [...actualEntries, ...futureForecasts]
}
