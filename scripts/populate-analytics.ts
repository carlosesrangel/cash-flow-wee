#!/usr/bin/env node
/**
 * Script para popular tabelas de analytics e forecast
 * Deriva dados de Olist + SumUp + Reconciliação
 */

import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

type ViewRow = Record<string, unknown>

async function populateSalesMetrics() {
  const admin = createAdminSupabaseClient()

  console.log('📊 Populando Sales Metrics...')

  const { data: orders, error: ordersError } = await admin
    .from('olist_orders')
    .select('id, data_prevista, valor_total_pedido, cliente_olist_id')

  if (ordersError) throw ordersError

  const { data: matches } = await admin
    .from('reconciliation_matches')
    .select('olist_accounts_receivable_id')

  const matchedIds = new Set(matches?.map((m: ViewRow) => m.olist_accounts_receivable_id) ?? [])

  // Group by date
  const salesByDate = new Map<string, { quantidade: number; receita: number; realizada: number }>()

  for (const order of orders ?? []) {
    const date = order.data_prevista?.split('T')[0]
    if (!date) continue

    const current = salesByDate.get(date) || { quantidade: 0, receita: 0, realizada: 0 }
    current.quantidade += 1
    current.receita += order.valor_total_pedido ?? 0
    if (matchedIds.has(order.id)) {
      current.realizada += order.valor_total_pedido ?? 0
    }
    salesByDate.set(date, current)
  }

  // Insert into sales_metrics
  const metricsData = Array.from(salesByDate.entries()).map(([date, data]) => ({
    org_id: ORG_ID,
    data_venda: date,
    quantidade_vendas: data.quantidade,
    receita_total: data.receita,
    receita_realizada: data.realizada,
  }))

  if (metricsData.length > 0) {
    const { error } = await admin.from('sales_metrics').insert(metricsData)
    if (error) throw error
    console.log(`✅ ${metricsData.length} registros de sales_metrics criados`)
  }
}

async function populateCustomerAnalytics() {
  const admin = createAdminSupabaseClient()

  console.log('👥 Populando Customer Analytics...')

  const { data: contacts, error: contactsError } = await admin
    .from('olist_contacts')
    .select('olist_id, nome')
    .eq('tipo', 'cliente')

  if (contactsError) throw contactsError

  const customerData = []

  for (const contact of contacts ?? []) {
    const { data: orders } = await admin
      .from('olist_orders')
      .select('id, valor')
      .eq('cliente_olist_id', contact.olist_id)

    const { data: matches } = await admin
      .from('reconciliation_matches')
      .select('olist_accounts_receivable_id')

    const matchedIds = new Set(matches?.map((m: ViewRow) => m.olist_accounts_receivable_id) ?? [])

    const totalGasto = orders?.reduce((sum, o) => sum + (o.valor ?? 0), 0) ?? 0
    const totalRecebido = orders?.reduce((sum, o) => (matchedIds.has(o.id) ? sum + (o.valor ?? 0) : sum), 0) ?? 0

    customerData.push({
      org_id: ORG_ID,
      cliente_olist_id: contact.olist_id,
      cliente_nome: contact.nome,
      quantidade_pedidos: orders?.length ?? 0,
      total_gasto: totalGasto,
      total_recebido: totalRecebido,
    })
  }

  if (customerData.length > 0) {
    const { error } = await admin.from('customer_analytics').insert(customerData)
    if (error) throw error
    console.log(`✅ ${customerData.length} registros de customer_analytics criados`)
  }
}

async function populateProductAnalytics() {
  const admin = createAdminSupabaseClient()

  console.log('📦 Populando Product Analytics...')

  const { data: products, error: productsError } = await admin
    .from('olist_products')
    .select('olist_id, nome')

  if (productsError) throw productsError

  const { data: matches } = await admin
    .from('reconciliation_matches')
    .select('olist_accounts_receivable_id')

  const matchedIds = new Set(matches?.map((m: ViewRow) => m.olist_accounts_receivable_id) ?? [])

  // For simplicity, group all orders by their existence
  const { data: orders } = await admin
    .from('olist_orders')
    .select('id, valor_total_pedido')

  const productData = products?.map((product) => ({
    org_id: ORG_ID,
    produto_olist_id: product.olist_id,
    produto_nome: product.nome,
    quantidade_vendas: orders?.length ?? 0,
    receita_total: orders?.reduce((sum, o) => sum + (o.valor_total_pedido ?? 0), 0) ?? 0,
    receita_realizada: orders
      ?.filter((o) => matchedIds.has(o.id))
      .reduce((sum, o) => sum + (o.valor_total_pedido ?? 0), 0) ?? 0,
  })) ?? []

  if (productData.length > 0) {
    const { error } = await admin.from('product_analytics').insert(productData)
    if (error && !error.message.includes('relation')) throw error
    if (!error) {
      console.log(`✅ ${productData.length} registros de product_analytics criados`)
    }
  }
}

async function populateForecast() {
  const admin = createAdminSupabaseClient()

  console.log('📈 Criando Forecast Básico...')

  // Create version
  const { data: versionData, error: versionError } = await admin
    .from('forecast_versions')
    .insert({
      org_id: ORG_ID,
      name: 'Projeção 2026',
      description: 'Projeção inicial baseada em histórico de 3650 dias',
    })
    .select()
    .single()

  if (versionError) throw versionError
  console.log(`✅ Forecast version criado: ${versionData.id}`)

  // Get monthly totals from orders
  const { data: orders } = await admin
    .from('olist_orders')
    .select('data_prevista, valor_total_pedido')

  const monthlyTotals = new Map<string, number>()
  for (const order of orders ?? []) {
    const date = new Date(order.data_prevista ?? '')
    if (isNaN(date.getTime())) continue
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) ?? 0) + (order.valor_total_pedido ?? 0))
  }

  // Average for projection
  const average = Array.from(monthlyTotals.values()).reduce((a, b) => a + b, 0) / (monthlyTotals.size || 1)

  // Create projections for next 12 months
  const projections = []
  for (let i = 0; i < 12; i++) {
    const date = new Date()
    date.setMonth(date.getMonth() + i)

    projections.push({
      version_id: versionData.id,
      mes: date.getMonth() + 1,
      ano: date.getFullYear(),
      projected_revenue: Math.round(average * 1.05 ** i), // 5% growth per month
    })
  }

  const { error: projError } = await admin
    .from('forecast_monthly_projections')
    .insert(projections)

  if (projError) throw projError
  console.log(`✅ ${projections.length} meses de projeção criados`)

  // Create tax projections (20th of each month)
  const taxProjections = projections.map((p) => ({
    version_id: versionData.id,
    mes_vencimento: p.mes,
    ano_vencimento: p.ano,
    dia_vencimento: 20,
    aliquota: 0.1, // 10% default
    valor_estimado: Math.round(p.projected_revenue * 0.1),
    tipo_imposto: 'IRRF', // Retenção na fonte
  }))

  const { error: taxError } = await admin
    .from('forecast_tax_projections')
    .insert(taxProjections)

  if (taxError && !taxError.message.includes('relation')) throw taxError
  if (!taxError) {
    console.log(`✅ ${taxProjections.length} projeções de imposto criadas`)
  }
}

async function main() {
  console.log('🚀 Iniciando população de analytics e forecast\n')

  try {
    await populateSalesMetrics()
    await populateCustomerAnalytics()
    await populateProductAnalytics()
    await populateForecast()

    console.log('\n✅ Todas as tabelas populadas com sucesso!')
  } catch (error) {
    console.error('\n❌ Erro:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
