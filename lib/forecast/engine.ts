import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type ForecastVersion = { id: string; name: string; createdAt: string }
export type ForecastScenario = { id: string; name: string; createdAt: string }

type VersionRow = { id: string; name: string; created_at: string }
type EntryRow = { ano: number; mes: number; receita: number }

/** Ordered most-recent-first: `versions[0]` is always the editable "current" version. */
export async function loadAllVersions(orgId: string): Promise<ForecastVersion[]> {
  const admin = createAdminSupabaseClient()
  const rows = await fetchAllPages<VersionRow>(
    (from, to) =>
      admin
        .from('forecast_versions')
        .select('id, name, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .range(from, to),
    'Failed to load forecast_versions'
  )
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }))
}

/**
 * Loads a version's entries after confirming the version belongs to
 * `orgId` — `service_role` bypasses RLS, so this explicit check is what
 * stops one org from reading another org's forecast by id-guessing.
 */
export async function loadVersionEntries(orgId: string, versionId: string): Promise<MonthlyValue[]> {
  const admin = createAdminSupabaseClient()

  const { data: version, error: versionError } = await admin
    .from('forecast_versions')
    .select('id')
    .eq('id', versionId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (versionError) throw new Error(`Failed to load forecast_versions: ${versionError.message}`)
  if (!version) throw new Error('Versão não encontrada')

  const rows = await fetchAllPages<EntryRow>(
    (from, to) =>
      admin
        .from('forecast_entries')
        .select('ano, mes, receita')
        .eq('version_id', versionId)
        .order('ano')
        .order('mes')
        .range(from, to),
    'Failed to load forecast_entries'
  )
  return rows.map((r) => ({ ano: r.ano, mes: r.mes, value: r.receita }))
}

type ScenarioRow = { id: string; name: string; created_at: string }
type MultiplierRow = { ano: number; mes: number; percentual: number }

async function loadMultipliers(admin: AdminClient, scenarioId: string): Promise<MonthlyValue[]> {
  const rows = await fetchAllPages<MultiplierRow>(
    (from, to) =>
      admin
        .from('forecast_scenario_multipliers')
        .select('ano, mes, percentual')
        .eq('scenario_id', scenarioId)
        .range(from, to),
    'Failed to load forecast_scenario_multipliers'
  )
  return rows.map((r) => ({ ano: r.ano, mes: r.mes, value: r.percentual }))
}

export async function loadScenarios(
  orgId: string
): Promise<Array<{ scenario: ForecastScenario; multipliers: MonthlyValue[] }>> {
  const admin = createAdminSupabaseClient()
  const scenarios = await fetchAllPages<ScenarioRow>(
    (from, to) =>
      admin.from('forecast_scenarios').select('id, name, created_at').eq('org_id', orgId).order('created_at').range(from, to),
    'Failed to load forecast_scenarios'
  )

  const result: Array<{ scenario: ForecastScenario; multipliers: MonthlyValue[] }> = []
  for (const scenario of scenarios) {
    const multipliers = await loadMultipliers(admin, scenario.id)
    result.push({ scenario: { id: scenario.id, name: scenario.name, createdAt: scenario.created_at }, multipliers })
  }
  return result
}

type OrderRow = { data: string; valor_total_pedido: number | null }

/**
 * Sums olist_orders.valor_total_pedido by month of `data`, for every month
 * that has at least one synced order. Deliberately does NOT filter by
 * `situacao` — see the Global Constraints note on this in the plan header
 * and docs/assumptions.md ("Riscos conhecidos — Fase 6B").
 */
export async function loadRealizadoByMonth(orgId: string): Promise<MonthlyValue[]> {
  const admin = createAdminSupabaseClient()
  const rows = await fetchAllPages<OrderRow>(
    (from, to) =>
      admin.from('olist_orders').select('data, valor_total_pedido').eq('org_id', orgId).not('data', 'is', null).range(from, to),
    'Failed to load olist_orders for forecast comparison'
  )

  const totals = new Map<string, { ano: number; mes: number; value: number }>()
  for (const row of rows) {
    const [ano, mes] = row.data.split('-').map(Number)
    const key = `${ano}-${mes}`
    const existing = totals.get(key) ?? { ano, mes, value: 0 }
    existing.value += row.valor_total_pedido ?? 0
    totals.set(key, existing)
  }

  return Array.from(totals.values())
}

export async function createForecastVersion(orgId: string, name: string, actorProfileId: string): Promise<ForecastVersion> {
  const admin = createAdminSupabaseClient()
  const versions = await loadAllVersions(orgId)
  const current = versions[0]

  const { data: version, error: versionError } = await admin
    .from('forecast_versions')
    .insert({ org_id: orgId, name, created_by: actorProfileId })
    .select('id, name, created_at')
    .single()
  if (versionError) throw new Error(`Failed to create forecast_versions: ${versionError.message}`)

  if (current) {
    const entries = await loadVersionEntries(orgId, current.id)
    if (entries.length > 0) {
      const { error: copyError } = await admin.from('forecast_entries').insert(
        entries.map((e) => ({
          version_id: version.id,
          ano: e.ano,
          mes: e.mes,
          receita: e.value,
          updated_by: actorProfileId,
        }))
      )
      if (copyError) throw new Error(`Failed to copy forecast_entries: ${copyError.message}`)
    }
  }

  return { id: version.id, name: version.name, createdAt: version.created_at }
}

/**
 * Upserts a single cell of the planning grid. Throws if `versionId` is not
 * the org's current (most recently created) version — editing a version
 * that has been superseded would silently rewrite history instead of
 * creating a new version, which Prompt Mestre seção 15 explicitly forbids
 * ("Não sobrescrever previsões antigas").
 */
export async function updateForecastEntry(
  orgId: string,
  versionId: string,
  ano: number,
  mes: number,
  receita: number,
  actorProfileId: string
): Promise<void> {
  const admin = createAdminSupabaseClient()
  const versions = await loadAllVersions(orgId)
  const current = versions[0]
  if (!current || current.id !== versionId) {
    throw new Error('Só é possível editar a versão mais recente do forecast')
  }

  const { error } = await admin
    .from('forecast_entries')
    .upsert(
      { version_id: versionId, ano, mes, receita, updated_by: actorProfileId, updated_at: new Date().toISOString() },
      { onConflict: 'version_id,ano,mes' }
    )
  if (error) throw new Error(`Failed to upsert forecast_entries: ${error.message}`)
}

export async function createForecastScenario(
  orgId: string,
  name: string,
  actorProfileId: string,
  duplicateFromScenarioId?: string
): Promise<ForecastScenario> {
  const admin = createAdminSupabaseClient()

  let sourceMultipliers: MonthlyValue[] = []
  if (duplicateFromScenarioId) {
    const { data: source, error: sourceError } = await admin
      .from('forecast_scenarios')
      .select('id')
      .eq('id', duplicateFromScenarioId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (sourceError) throw new Error(`Failed to load forecast_scenarios: ${sourceError.message}`)
    if (!source) throw new Error('Cenário de origem não encontrado')
    sourceMultipliers = await loadMultipliers(admin, duplicateFromScenarioId)
  }

  const { data: scenario, error: scenarioError } = await admin
    .from('forecast_scenarios')
    .insert({ org_id: orgId, name, created_by: actorProfileId })
    .select('id, name, created_at')
    .single()
  if (scenarioError) throw new Error(`Failed to create forecast_scenarios: ${scenarioError.message}`)

  if (sourceMultipliers.length > 0) {
    const { error: copyError } = await admin.from('forecast_scenario_multipliers').insert(
      sourceMultipliers.map((m) => ({ scenario_id: scenario.id, ano: m.ano, mes: m.mes, percentual: m.value }))
    )
    if (copyError) throw new Error(`Failed to duplicate forecast_scenario_multipliers: ${copyError.message}`)
  }

  return { id: scenario.id, name: scenario.name, createdAt: scenario.created_at }
}

/**
 * Upserts a single scenario/month multiplier, after confirming `scenarioId`
 * belongs to `orgId` — same tenant-isolation reasoning as
 * `loadVersionEntries` above.
 */
export async function updateScenarioMultiplier(
  orgId: string,
  scenarioId: string,
  ano: number,
  mes: number,
  percentual: number
): Promise<void> {
  const admin = createAdminSupabaseClient()

  const { data: scenario, error: scenarioError } = await admin
    .from('forecast_scenarios')
    .select('id')
    .eq('id', scenarioId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (scenarioError) throw new Error(`Failed to load forecast_scenarios: ${scenarioError.message}`)
  if (!scenario) throw new Error('Cenário não encontrado')

  const { error } = await admin
    .from('forecast_scenario_multipliers')
    .upsert({ scenario_id: scenarioId, ano, mes, percentual }, { onConflict: 'scenario_id,ano,mes' })
  if (error) throw new Error(`Failed to upsert forecast_scenario_multipliers: ${error.message}`)
}
