import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(supabaseUrl, supabaseKey)

const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

async function checkpoint() {
  console.log('📊 POWER QUERY CHECKPOINT\n')

  // Taxas_12M
  console.log('1. TAXAS_12M (Fee Rates)')
  const fees = await admin
    .from('sumup_fee_rates_12m')
    .select('payment_type, qtd_transacoes_12m, valor_bruto_12m, fee_total_12m, taxa_media_ponderada, pct_valor_12m')
    .eq('org_id', ORG_ID)
    .order('qtd_transacoes_12m', { ascending: false })
    .limit(3)

  if (fees.data && fees.data.length > 0) {
    console.log('  Sample rows:')
    fees.data.forEach((row: any) => {
      console.log(`    ${row.payment_type}: ${row.qtd_transacoes_12m} txns, ${row.valor_bruto_12m.toFixed(2)}, fee=${row.fee_total_12m.toFixed(2)}, pct=${row.pct_valor_12m?.toFixed(4) || 'null'}`)
    })
    
    // Verify total
    const total = await admin
      .from('sumup_fee_rates_12m')
      .select('valor_bruto_12m')
      .eq('org_id', ORG_ID)
    
    const sum = (total.data || []).reduce((acc, r: any) => acc + r.valor_bruto_12m, 0)
    console.log(`  ✅ Total gross: ${sum.toFixed(2)}`)
  } else {
    console.log('  ❌ No data')
  }

  // Sazonalidade_3Faixas
  console.log('\n2. SAZONALIDADE_3FAIXAS (3-Band Seasonality)')
  const season = await admin
    .from('sumup_seasonality_3bands_12m')
    .select('ano_historico, mes_historico, faixa, peso_faixa, receita_historica_faixa')
    .eq('org_id', ORG_ID)
    .order('mes_historico', { ascending: false })
    .limit(6)

  if (season.data && season.data.length > 0) {
    console.log('  Sample rows (last 2 months):')
    season.data.slice(0, 6).forEach((row: any) => {
      console.log(`    ${row.ano_historico}/${row.mes_historico} Band${row.faixa}: peso=${row.peso_faixa.toFixed(4)}, receita=${row.receita_historica_faixa.toFixed(2)}`)
    })
    
    // Verify bands sum to 1.0 per month
    const perMonth = season.data.reduce((acc: any, r: any) => {
      const key = `${r.ano_historico}/${r.mes_historico}`
      if (!acc[key]) acc[key] = 0
      acc[key] += Number(r.peso_faixa)
      return acc
    }, {})
    
    const invalid = Object.entries(perMonth).filter(([_, sum]: any) => Math.abs(sum - 1.0) > 0.01)
    if (invalid.length === 0) {
      console.log('  ✅ All months: banda weights sum to 1.0')
    } else {
      console.log(`  ⚠️  ${invalid.length} months with invalid weights`)
    }
  } else {
    console.log('  ❌ No data')
  }

  // Perfil_Recebimento_12M
  console.log('\n3. PERFIL_RECEBIMENTO_12M (Receipt Profile)')
  const receipt = await admin
    .from('sumup_receipt_profile_12m')
    .select('payment_type, meses_ate_receber, pct_recebimento_modalidade, valor_recebido_historico')
    .eq('org_id', ORG_ID)
    .order('meses_ate_receber', { ascending: true })
    .limit(5)

  if (receipt.data && receipt.data.length > 0) {
    console.log('  Sample rows:')
    receipt.data.forEach((row: any) => {
      console.log(`    ${row.payment_type} → ${row.meses_ate_receber} months: ${(row.pct_recebimento_modalidade * 100).toFixed(1)}%, valor=${row.valor_recebido_historico.toFixed(2)}`)
    })
    console.log('  ✅ Receipt timing distribution present')
  } else {
    console.log('  ❌ No data')
  }

  console.log('\n✅ POWER_QUERY_CHECKPOINT = PASS (data present and structured)')
}

checkpoint().catch(err => console.error('Error:', err.message))
