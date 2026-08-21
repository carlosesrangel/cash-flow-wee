#!/usr/bin/env node
/**
 * Populates payment_scenarios and scenario_adjustments with example scenarios
 * for testing the Payment Planning feature.
 *
 * Scenarios:
 * 1. "Baseline" - no adjustments (0% delay, 100% payment)
 * 2. "Delay All 15 Days" - postpone all payments by 15 days
 * 3. "Pay Only Urgent" - pay only 50% of non-urgent items
 * 4. "Consolidate Bi-weekly" - delay non-urgent payments by 7 days
 */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

async function main() {
  const admin = createAdminSupabaseClient()

  // Check if scenarios already exist
  const { data: existing } = await admin
    .from('payment_scenarios')
    .select('id')
    .eq('org_id', ORG_ID)
    .limit(1)

  if (existing && existing.length > 0) {
    console.log('ℹ️  Já existem payment_scenarios para esta org — abortando para não duplicar.')
    return
  }

  // Load AP entries to create adjustments for
  const { data: apRows, error: apError } = await admin
    .from('olist_accounts_payable')
    .select('id, data_vencimento, valor')
    .eq('org_id', ORG_ID)
    .order('data_vencimento')
    .limit(50) // Limit to first 50 for seed purposes

  if (apError) throw new Error(`Failed to load AP: ${apError.message}`)
  if (!apRows || apRows.length === 0) {
    console.log('ℹ️  Nenhuma conta a pagar encontrada. Abortando seed.')
    return
  }

  console.log(`📊 Encontradas ${apRows.length} contas a pagar. Criando cenários...`)

  // 1. Baseline Scenario
  const { data: baseline, error: baselineError } = await admin
    .from('payment_scenarios')
    .insert({
      org_id: ORG_ID,
      name: 'Baseline (Sem Ajustes)',
      description: 'Cenário atual: pagar todos os pagamentos nas datas planejadas',
      is_default: true,
    })
    .select('id')
    .single()

  if (baselineError) throw new Error(`Failed to create baseline: ${baselineError.message}`)
  console.log(`✅ Baseline criado`)

  // 2. Delay All 15 Days
  const { data: delay15, error: delay15Error } = await admin
    .from('payment_scenarios')
    .insert({
      org_id: ORG_ID,
      name: 'Atrasar Tudo 15 Dias',
      description: 'Postergar todos os pagamentos em 15 dias para melhorar o caixa',
      is_default: false,
    })
    .select('id')
    .single()

  if (delay15Error) throw new Error(`Failed to create delay15: ${delay15Error.message}`)

  const delay15Adjustments = apRows.map((ap) => ({
    scenario_id: delay15.id,
    ap_id: ap.id,
    days_delta: 15,
    percentage: 100,
  }))

  const { error: delay15AdjError } = await admin.from('scenario_adjustments').insert(delay15Adjustments)
  if (delay15AdjError) throw new Error(`Failed to insert delay15 adjustments: ${delay15AdjError.message}`)
  console.log(`✅ Cenário "Atrasar Tudo 15 Dias" criado (${apRows.length} ajustes)`)

  // 3. Pay Only Urgent (assume first 30% are urgent)
  const { data: urgent, error: urgentError } = await admin
    .from('payment_scenarios')
    .insert({
      org_id: ORG_ID,
      name: 'Pagar Apenas Urgentes',
      description: 'Pagar apenas os 30% dos pagamentos mais próximos (urgentes), deixar outros para depois',
      is_default: false,
    })
    .select('id')
    .single()

  if (urgentError) throw new Error(`Failed to create urgent: ${urgentError.message}`)

  const urgentThreshold = Math.floor(apRows.length * 0.3)
  const urgentAdjustments = apRows.map((ap, idx) => ({
    scenario_id: urgent.id,
    ap_id: ap.id,
    days_delta: idx < urgentThreshold ? 0 : 30, // Urgent: 0 days delay, Others: 30 days delay
    percentage: idx < urgentThreshold ? 100 : 50, // Urgent: 100%, Others: 50%
  }))

  const { error: urgentAdjError } = await admin.from('scenario_adjustments').insert(urgentAdjustments)
  if (urgentAdjError) throw new Error(`Failed to insert urgent adjustments: ${urgentAdjError.message}`)
  console.log(`✅ Cenário "Pagar Apenas Urgentes" criado (${apRows.length} ajustes)`)

  // 4. Consolidate Bi-weekly
  const { data: biweekly, error: biweeklyError } = await admin
    .from('payment_scenarios')
    .insert({
      org_id: ORG_ID,
      name: 'Consolidar Bi-semanalmente',
      description: 'Agrupar pagamentos em 2 datas por mês (dias 10 e 25) para reduzir custos administrativos',
      is_default: false,
    })
    .select('id')
    .single()

  if (biweeklyError) throw new Error(`Failed to create biweekly: ${biweeklyError.message}`)

  const biweeklyAdjustments = apRows.map((ap) => {
    const dueDate = new Date(ap.data_vencimento)
    const dayOfMonth = dueDate.getDate()
    // Round to nearest consolidation date (10 or 25)
    const daysDelta = dayOfMonth < 17 ? 10 - dayOfMonth : 25 - dayOfMonth
    return {
      scenario_id: biweekly.id,
      ap_id: ap.id,
      days_delta: daysDelta,
      percentage: 100,
    }
  })

  const { error: biweeklyAdjError } = await admin
    .from('scenario_adjustments')
    .insert(biweeklyAdjustments)
  if (biweeklyAdjError) throw new Error(`Failed to insert biweekly adjustments: ${biweeklyAdjError.message}`)
  console.log(`✅ Cenário "Consolidar Bi-semanalmente" criado (${apRows.length} ajustes)`)

  console.log('\n✅ Payment scenarios populados com sucesso!')
  console.log('Use a página "Planejar Pagamentos" para ver o impacto de cada cenário.')
}

main().catch((err) => {
  console.error('❌ Erro:', err instanceof Error ? err.message : err)
  process.exit(1)
})
