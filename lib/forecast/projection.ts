import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadAllVersions, loadVersionEntries, loadScenarios } from '@/lib/forecast/engine'
import { applyScenario } from '@/lib/forecast/scenarios'
import { firstDayOfNextMonth } from '@/lib/forecast/cutoff'
import { loadCanonicalPlan, loadScenarioConfig } from '@/lib/planning/canonical-repository'
import { applyScenarioToPlan } from '@/lib/planning/canonical'
import { transformForecastToReceipts } from '@/lib/forecast/transform'
import { toLocalDateParam } from '@/lib/integrations/date'
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
    description: 'Entrada projetada',
  })).filter((entry) => entry.date >= firstDayOfNextMonth())

  return entries
}

/** Primary projection loader. Legacy versioned forecasts remain readable for audit only. */
export async function loadCanonicalForecastedCashFlowEntries(
  orgId: string,
  scenario: 'base' | 'conservative' | 'optimistic' = 'base',
  suppliedClient?: { from: (table: string) => any },
): Promise<CashFlowEntry[]> {
  const [plans, config] = await Promise.all([loadCanonicalPlan(orgId, undefined, undefined, suppliedClient), loadScenarioConfig(orgId, suppliedClient)])
  const selected = applyScenarioToPlan(plans, scenario, config)
  const futurePlans = selected.filter((plan) => plan.competenceMonth >= firstDayOfNextMonth())
  if (futurePlans.length === 0) return []
  const client = suppliedClient ?? createAdminSupabaseClient()
  try {
    const receipts = await transformForecastToReceipts(client, orgId, futurePlans.map((plan) => ({ ano: Number(plan.competenceMonth.slice(0, 4)), mes: Number(plan.competenceMonth.slice(5, 7)), value: plan.amount })))
    return receipts.filter((receipt) => toLocalDateParam(receipt.data_recebimento) >= firstDayOfNextMonth()).map((receipt, index) => ({
      id: `canonical-receipt-${receipt.data_venda.toISOString()}-${index}`,
      origin: 'forecast' as const,
      sourceId: `monthly_sales_plan:${toLocalDateParam(receipt.data_venda).slice(0, 7)}`,
      date: toLocalDateParam(receipt.data_recebimento),
      amount: receipt.recebimento_liquido_projetado,
      direction: 'entrada' as const,
      bucket: 'projetado' as const,
      description: `Entrada projetada · ${receipt.modalidade}`,
    }))
  } catch (error) {
    console.warn('Forecast receipt projection unavailable without factual mix/profile:', error)
    return []
  }
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
  // Never show projected values in the current or a previous local month.
  const futureForecasts = forecastEntries.filter((f) => {
    if (!f.date) return false
    const nextMonth = today.mes === 12 ? { ano: today.ano + 1, mes: 1 } : { ano: today.ano, mes: today.mes + 1 }
    return f.date >= `${nextMonth.ano}-${String(nextMonth.mes).padStart(2, '0')}-01`
  })

  // Combine (actual first, then future forecast)
  return [...actualEntries, ...futureForecasts]
}
