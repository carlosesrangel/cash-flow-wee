#!/usr/bin/env node
/**
 * Popula forecast_versions/entries/scenarios/multipliers para 60 meses (2026-2030).
 * Também cria:
 * - sales_mix (modalidades de pagamento, parcelas, taxas)
 * - cmv_projections (CMV com defasagem trimestral Q2→Q1)
 * - planning_assumptions (histórico de assunções)
 * - accounts_receivable_projected (AR projetado)
 *
 * Run: npm run seed:forecast:60months
 */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { populateProjectedAR } from '@/lib/forecast/projections'

type ViewRow = Record<string, unknown>

const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

function monthKey(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, '0')}-01`
}

/**
 * CMV Defasagem: Q2 budget (Apr-Jun) is spent bi-weekly in Q1 (Jan-Mar).
 * Simplified: For each quarter, allocate CMV to the previous quarter (3 months back)
 */
function computeCMVDefasagem(baseRevenue: number): {
  ano: number; mes: number; semana: string; valor: number; trimestre_origem: string
}[] {
  const cmvEntries: {ano: number; mes: number; semana: string; valor: number; trimestre_origem: string}[] = []
  const cmvPercentual = 0.4 // CMV = 40% of revenue

  // For years 2026-2030, calculate CMV per quarter and allocate to previous quarter
  for (let ano = 2026; ano <= 2030; ano++) {
    for (let q = 1; q <= 4; q++) {
      // Seasonal factors
      const seasonal = q === 4 ? 1.4 : 1.0 // Q4 (Oct-Dec) is stronger

      // Revenue for this quarter
      const quarter_revenue = baseRevenue * 3 * seasonal
      const quarter_cmv = quarter_revenue * cmvPercentual
      const cmv_per_semana = quarter_cmv / 4

      // Determine when to spend this CMV (previous quarter)
      let ano_gasto = ano
      let mes_gasto_start = (q - 1) * 3 + 1 // Q1→1, Q2→4, Q3→7, Q4→10

      // Shift back one quarter (3 months)
      mes_gasto_start -= 3
      if (mes_gasto_start <= 0) {
        mes_gasto_start += 12
        ano_gasto -= 1
      }

      // Only create entries for valid years (2026+)
      if (ano_gasto < 2026) continue

      // Distribute across 4 weeks in 2 months
      const mes_1 = mes_gasto_start
      const mes_2 = mes_gasto_start + 1

      if (mes_1 >= 1 && mes_1 <= 12) {
        cmvEntries.push({
          ano: ano_gasto,
          mes: mes_1,
          semana: 'semana_1',
          valor: cmv_per_semana,
          trimestre_origem: `Q${q}-${ano}`,
        })
        cmvEntries.push({
          ano: ano_gasto,
          mes: mes_1,
          semana: 'semana_2',
          valor: cmv_per_semana,
          trimestre_origem: `Q${q}-${ano}`,
        })
      }

      if (mes_2 >= 1 && mes_2 <= 12) {
        cmvEntries.push({
          ano: ano_gasto,
          mes: mes_2,
          semana: 'semana_3',
          valor: cmv_per_semana,
          trimestre_origem: `Q${q}-${ano}`,
        })
        cmvEntries.push({
          ano: ano_gasto,
          mes: mes_2,
          semana: 'semana_4',
          valor: cmv_per_semana,
          trimestre_origem: `Q${q}-${ano}`,
        })
      }
    }
  }

  return cmvEntries
}

async function main() {
  const admin = createAdminSupabaseClient()

  // Check if version already exists
  const { data: existing } = await admin
    .from('forecast_versions')
    .select('id')
    .eq('org_id', ORG_ID)
    .ilike('name', '%60 meses%')
    .limit(1)

  if (existing && existing.length > 0) {
    console.log('ℹ️  Já existe forecast_versions com "60 meses" — abortando para não duplicar.')
    return
  }

  const today = new Date()
  const currentKey = monthKey(today.getFullYear(), today.getMonth() + 1)

  // Get last 6 months of actual revenue
  const { data: history } = await admin
    .from('v_monthly_revenue')
    .select('month, revenue_total')
    .eq('org_id', ORG_ID)
    .lte('month', currentKey)
    .order('month', { ascending: false })
    .limit(6)

  const avg =
    (history ?? []).reduce((sum, m: ViewRow) => sum + (m.revenue_total as number ?? 0), 0) / ((history ?? []).length || 1)
  const baseRevenue = Math.round(avg) || 15000

  console.log(`📊 Base de projeção (média últimos ${history?.length ?? 0} meses): R$ ${baseRevenue}`)

  // 1. Create version
  const { data: version, error: versionError } = await admin
    .from('forecast_versions')
    .insert({ org_id: ORG_ID, name: 'Projeção 60 meses (2026-2030)' })
    .select('id')
    .single()
  if (versionError) throw new Error(`forecast_versions: ${versionError.message}`)
  console.log(`✅ forecast_versions criado: ${version.id}`)

  // 2. Create 60 months of forecast_entries (2026-2030)
  const entries = []
  for (let ano = 2026; ano <= 2030; ano++) {
    for (let mes = 1; mes <= 12; mes++) {
      const seasonal = [11, 12].includes(mes) ? 1.4 : 1.0 // Nov/Dez stronger
      const growth = (ano - 2026) * 0.05 // 5% annual growth
      entries.push({
        version_id: version.id,
        ano,
        mes,
        receita: Math.round(baseRevenue * seasonal * (1 + growth)),
      })
    }
  }
  const { error: entriesError } = await admin.from('forecast_entries').insert(entries)
  if (entriesError) throw new Error(`forecast_entries: ${entriesError.message}`)
  console.log(`✅ 60 forecast_entries criados (2026-2030)`)

  // 3. Create sales_mix defaults
  const mixDefaults = [
    { modalidade: 'credito', percentual: 60, parcelas_media: 3, taxa_cartao: 0.025, dias_recebimento: 2 },
    { modalidade: 'debito', percentual: 30, parcelas_media: 1, taxa_cartao: 0.015, dias_recebimento: 1 },
    { modalidade: 'pix', percentual: 8, parcelas_media: 1, taxa_cartao: 0.001, dias_recebimento: 0 },
    { modalidade: 'dinheiro', percentual: 2, parcelas_media: 1, taxa_cartao: 0, dias_recebimento: 0 },
  ]

  const mixInserts = mixDefaults.map((m) => ({
    org_id: ORG_ID,
    version_id: version.id,
    modalidade: m.modalidade,
    percentual: m.percentual,
    parcelas_media: m.parcelas_media,
    taxa_cartao: m.taxa_cartao,
    dias_recebimento: m.dias_recebimento,
  }))

  const { error: mixError } = await admin.from('sales_mix').insert(mixInserts)
  if (mixError) throw new Error(`sales_mix: ${mixError.message}`)
  console.log(`✅ sales_mix criado (4 modalidades)`)

  // 4. Create planning_assumptions
  const assumptions = [
    { assumption_key: 'base_revenue', valor_numerico: baseRevenue },
    { assumption_key: 'seasonal_nov_dec', valor_numerico: 1.4 },
    { assumption_key: 'annual_growth', valor_numerico: 0.05 },
    { assumption_key: 'cmv_percentual', valor_numerico: 0.4 },
    { assumption_key: 'versao_descricao', valor_texto: '60 meses com mix de vendas e CMV defasado' },
  ]

  const assumeInserts = assumptions.map((a) => ({
    org_id: ORG_ID,
    version_id: version.id,
    assumption_key: a.assumption_key,
    valor_numerico: a.valor_numerico,
    valor_texto: a.valor_texto,
  }))

  const { error: assumeError } = await admin.from('planning_assumptions').insert(assumeInserts)
  if (assumeError) throw new Error(`planning_assumptions: ${assumeError.message}`)
  console.log(`✅ planning_assumptions criado (5 assunções)`)

  // 5. Create CMV projections with defasagem
  const cmvDefasagem = computeCMVDefasagem(baseRevenue)
  const cmvInserts = cmvDefasagem
    .filter((c) => c.ano >= 2026 && c.ano <= 2030) // Only 2026-2030
    .map((c) => ({
      org_id: ORG_ID,
      version_id: version.id,
      ano_gasto: c.ano,
      mes_gasto: c.mes,
      trimestre_origem: c.trimestre_origem,
      valor_cmv: c.valor,
      semana: c.semana,
    }))

  const { error: cmvError } = await admin.from('cmv_projections').insert(cmvInserts)
  if (cmvError) throw new Error(`cmv_projections: ${cmvError.message}`)
  console.log(`✅ cmv_projections criado (${cmvInserts.length} entradas com defasagem)`)

  // 6. Create scenarios: Base, Conservador, Otimista
  const scenarioDefs = [
    { name: 'Base', percentual: 100 },
    { name: 'Conservador', percentual: 80 },
    { name: 'Otimista', percentual: 125 },
  ]

  for (const def of scenarioDefs) {
    const { data: scenario, error: scenarioError } = await admin
      .from('forecast_scenarios')
      .insert({ org_id: ORG_ID, name: def.name })
      .select('id')
      .single()
    if (scenarioError) throw new Error(`forecast_scenarios (${def.name}): ${scenarioError.message}`)

    const multipliers = entries.map((e) => ({
      scenario_id: scenario.id,
      ano: e.ano,
      mes: e.mes,
      percentual: def.percentual,
    }))

    const { error: multError } = await admin.from('forecast_scenario_multipliers').insert(multipliers)
    if (multError) throw new Error(`forecast_scenario_multipliers (${def.name}): ${multError.message}`)

    console.log(`✅ Cenário "${def.name}" criado (${def.percentual}%)`)
  }

  // 7. Generate projected AR entries
  const arCount = await populateProjectedAR(version.id, ORG_ID)
  console.log(`✅ Accounts receivable projetado gerado (${arCount} entradas)`)

  console.log('\n✅ Forecast 60 meses + sales_mix + CMV defasado + AR projetado populados com sucesso!')
}

main().catch((err) => {
  console.error('❌ Erro:', err instanceof Error ? err.message : err)
  process.exit(1)
})
