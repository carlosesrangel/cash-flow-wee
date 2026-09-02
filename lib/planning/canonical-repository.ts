import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { isPlanEditable, type MonthlyPlan, type ScenarioConfig, DEFAULT_SCENARIO_CONFIG } from './canonical'

type PlanRow = { competence_month: string; amount: number }
type DataClient = { from: (table: string) => any }

export async function loadCanonicalPlan(orgId: string, from?: string, to?: string, suppliedClient?: DataClient): Promise<MonthlyPlan[]> {
  const client = suppliedClient ?? createAdminSupabaseClient()
  const rows = await fetchAllPages<PlanRow>((start, end) => {
    let query = client.from('monthly_sales_plan').select('competence_month, amount').eq('org_id', orgId).order('competence_month').range(start, end)
    if (from) query = query.gte('competence_month', from)
    if (to) query = query.lte('competence_month', to)
    return query
  }, 'Falha ao carregar o plano mensal canônico')
  return rows.map((row) => ({ competenceMonth: row.competence_month, amount: Number(row.amount) || 0 }))
}

export async function loadScenarioConfig(orgId: string, suppliedClient?: DataClient): Promise<ScenarioConfig> {
  const client = suppliedClient ?? createAdminSupabaseClient()
  const { data, error } = await client.from('scenario_configurations').select('conservative_percent, optimistic_percent').eq('org_id', orgId).maybeSingle()
  if (error) throw new Error(`Falha ao carregar cenários: ${error.message}`)
  return data ? { conservativePercent: Number(data.conservative_percent), optimisticPercent: Number(data.optimistic_percent) } : DEFAULT_SCENARIO_CONFIG
}

export async function updateCanonicalPlan(
  client: DataClient,
  orgId: string,
  competenceMonth: string,
  amount: number,
  actorProfileId: string,
  now = new Date(),
) {
  if (!/^\d{4}-\d{2}-01$/.test(competenceMonth)) throw new Error('A competência deve ser o primeiro dia do mês')
  if (!isPlanEditable(competenceMonth, now)) throw new Error('O mês corrente e meses anteriores são somente leitura')
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Valor planejado inválido')

  const { data: before } = await client.from('monthly_sales_plan').select('amount').eq('org_id', orgId).eq('competence_month', competenceMonth).maybeSingle()
  const { error } = await client.from('monthly_sales_plan').upsert({ org_id: orgId, competence_month: competenceMonth, amount, updated_by: actorProfileId, updated_at: new Date().toISOString() }, { onConflict: 'org_id,competence_month' })
  if (error) throw new Error(`Falha ao atualizar o plano canônico: ${error.message}`)
  return { previousAmount: before?.amount == null ? null : Number(before.amount), amount }
}

export async function updateScenarioConfig(orgId: string, conservativePercent: number, optimisticPercent: number, actorProfileId: string, suppliedClient?: DataClient) {
  const client = suppliedClient ?? createAdminSupabaseClient()
  if (conservativePercent < 0 || conservativePercent > 100 || optimisticPercent < 0 || optimisticPercent > 500) throw new Error('Percentuais de cenário inválidos')
  const { error } = await client.from('scenario_configurations').upsert({ org_id: orgId, conservative_percent: conservativePercent, optimistic_percent: optimisticPercent, updated_by: actorProfileId, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
  if (error) throw new Error(`Falha ao salvar cenários: ${error.message}`)
}
