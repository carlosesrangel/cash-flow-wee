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

const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

function monthKey(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, '0')}-01`
}

/**
 * CMV Defasagem: Q2 budget (Apr-Jun) is spent bi-weekly in Q1 (Jan-Mar).
 * Returns array of {ano_gasto, mes_gasto, semana, valor_cmv} entries.
 */
function computeCMVDefasagem(baseRevenue: number): {
  ano: number; mes: number; semana: string; valor: number; trimestre_origem: string
}[] {
  const cmvEntries: {ano: number; mes: number; semana: string; valor: number; trimestre_origem: string}[] = []
  const cmvPercentual = 0.4 // CMV = 40% of revenue (example)

  // Each quarter's budget is spent in the previous quarter, distributed bi-weekly
  const quarters = [
    { origem: 'Q1-2026', gasto_em: { ano: 2025, mes: 10 } }, // Q1 2026 (Jan-Mar) spent in Q4 2025
    { origem: 'Q2-2026', gasto_em: { ano: 2026, mes: 1 } }, // Q2 2026 (Apr-Jun) spent in Q1 2026
    { origem: 'Q3-2026', gasto_em: { ano: 2026, mes: 4 } }, // Q3 2026 (Jul-Sep) spent in Q2 2026
    { origem: 'Q4-2026', gasto_em: { ano: 2026, mes: 7 } }, // Q4 2026 (Oct-Dec) spent in Q3 2026
    { origem: 'Q1-2027', gasto_em: { ano: 2026, mes: 10 } }, // Q1 2027 (Jan-Mar) spent in Q4 2026
    // ... continue pattern for remaining years
  ]

  // Simplified: compute for 2026-2027 only; extends as needed
  for (let ano = 2026; ano <= 2030; ano++) {
    for (let q = 1; q <= 4; q++) {
      const mes_inicio = (q - 1) * 3 + 1 // Q1→1, Q2→4, Q3→7, Q4→10
      const mes_gasto = q === 1 ? ((2025) % 1 + 12 + mes_inicio - 3) : (ano + Math.floor((mes_inicio - 3) / 12)) // prev quarter
      const ano_gasto = q === 1 ? ano - 1 : ano

      // Estimate revenue for this quarter as base * seasonal
      const seasonalQ1 = 1.0,
        seasonalQ2 = 1.0,
        seasonalQ3 = 1.0,
        seasonalQ4 = 1.4 // Nov/Dec stronger
      const seasonal =
        q === 1 ? seasonalQ1 : q === 2 ? seasonalQ2 : q === 3 ? seasonalQ3 : seasonalQ4

      const quarter_revenue = baseRevenue * 3 * seasonal
      const quarter_cmv = quarter_revenue * cmvPercentual
      const cmv_per_semana = quarter_cmv / 4

      // Distribute across 4 weeks (bi-weekly → semanas 1-4 of previous quarter)
      for (let w = 1; w <= 4; w++) {
        cmvEntries.push({
          ano: ano_gasto,
          mes: mes_gasto + (w > 2 ? 1 : 0), // Weeks 1-2 in first month, 3-4 in second
          semana: `semana_${w}`,
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
    (history ?? []).reduce((sum, m: any) => sum + (m.revenue_total ?? 0), 0) / ((history ?? []).length || 1)
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
