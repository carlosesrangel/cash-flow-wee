#!/usr/bin/env node
/**
 * Popula forecast_versions/forecast_entries/forecast_scenarios/forecast_scenario_multipliers
 * com uma projeção real baseada na média de receita total dos últimos 6 meses (v_monthly_revenue).
 * Roda uma vez para dar um ponto de partida editável via UI (Planejamento/Cenários).
 */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

function monthKey(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, '0')}-01`
}

async function main() {
  const admin = createAdminSupabaseClient()

  const { data: existing } = await admin.from('forecast_versions').select('id').eq('org_id', ORG_ID).limit(1)
  if (existing && existing.length > 0) {
    console.log('ℹ️  Já existe forecast_versions para esta org — abortando para não duplicar.')
    return
  }

  const today = new Date()
  const currentKey = monthKey(today.getFullYear(), today.getMonth() + 1)

  const { data: history } = await admin
    .from('v_monthly_revenue')
    .select('month, revenue_total')
    .eq('org_id', ORG_ID)
    .lte('month', currentKey)
    .order('month', { ascending: false })
    .limit(6)

  const avg =
    (history ?? []).reduce((sum, m: any) => sum + (m.revenue_total ?? 0), 0) / ((history ?? []).length || 1)
  const base = Math.round(avg) || 15000

  console.log(`📊 Base de projeção (média últimos ${history?.length ?? 0} meses reais): R$ ${base}`)

  // 1. Forecast version
  const { data: version, error: versionError } = await admin
    .from('forecast_versions')
    .insert({ org_id: ORG_ID, name: 'Projeção Base 2026-2027' })
    .select('id')
    .single()
  if (versionError) throw new Error(`forecast_versions: ${versionError.message}`)
  console.log(`✅ forecast_versions criado: ${version.id}`)

  // 2. 12 months forward, starting this month, light seasonal growth
  const entries = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
    const seasonal = [11, 0].includes(d.getMonth()) ? 1.4 : 1.0 // Nov/Dez (índices 10/11) mais forte
    entries.push({
      version_id: version.id,
      ano: d.getFullYear(),
      mes: d.getMonth() + 1,
      receita: Math.round(base * seasonal * (1 + 0.02 * i)), // leve crescimento mensal de 2%
    })
  }
  const { error: entriesError } = await admin.from('forecast_entries').insert(entries)
  if (entriesError) throw new Error(`forecast_entries: ${entriesError.message}`)
  console.log(`✅ ${entries.length} forecast_entries criados (${entries[0].ano}/${entries[0].mes} → ${entries[11].ano}/${entries[11].mes})`)

  // 3. Scenarios: Base, Conservador, Otimista
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

  console.log('\n✅ Forecast + Cenários populados com sucesso!')
}

main().catch((err) => {
  console.error('❌ Erro:', err instanceof Error ? err.message : err)
  process.exit(1)
})
