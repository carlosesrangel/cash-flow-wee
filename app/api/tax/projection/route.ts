import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { loadCanonicalPlan } from '@/lib/planning/canonical-repository'
import { calculateEffectiveSimplesTaxRate } from '@/lib/tax/simples-nacional'
import { taxPaymentDate } from '@/lib/tax/engine'
import { toLocalDateParam } from '@/lib/integrations/date'

type Order = { data: string | null; valor_total_pedido: number | null; situacao: string | number | null }

function addMonths(key: string, offset: number) {
  const [year, month] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  try {
    const client = await createServerSupabaseClient()
    const monthsToProject = Math.min(Math.max(Number(req.nextUrl.searchParams.get('months') ?? 12), 1), 36)
    const from = req.nextUrl.searchParams.get('from_date') ?? toLocalDateParam(new Date())
    const firstMonth = from.slice(0, 7)
    const [plans, taxConfig, orders] = await Promise.all([
      loadCanonicalPlan(member.orgId, addMonths(firstMonth, -12) + '-01', addMonths(firstMonth, monthsToProject - 1) + '-01', client),
      client.from('tax_configurations').select('simples_anexo, regime_2027').eq('org_id', member.orgId).maybeSingle(),
      fetchAllPages<Order>((start, end) => client.from('olist_orders').select('data, valor_total_pedido, situacao').eq('org_id', member.orgId).range(start, end), 'Falha ao carregar vendas para RBT12'),
    ])
    const validOrders = orders.filter((order) => !['cancelado', 'cancelada', 'cancelled', 'canceled'].includes(String(order.situacao ?? '').toLowerCase()) && order.data && Number(order.valor_total_pedido) > 0)
    const actualByMonth = new Map<string, number>()
    for (const order of validOrders) actualByMonth.set(order.data!.slice(0, 7), (actualByMonth.get(order.data!.slice(0, 7)) ?? 0) + Number(order.valor_total_pedido))
    const planByMonth = new Map(plans.map((plan) => [plan.competenceMonth.slice(0, 7), plan.amount]))
    const regime = taxConfig.data?.regime_2027 ?? 'simples-nacional-puro'
    const projections = Array.from({ length: monthsToProject }, (_, index) => {
      const key = addMonths(firstMonth, index)
      const year = Number(key.slice(0, 4)); const month = Number(key.slice(5, 7))
      const revenue = actualByMonth.get(key) ?? planByMonth.get(key) ?? 0
      const rbt12 = Array.from({ length: 12 }, (_, offset) => actualByMonth.get(addMonths(key, -11 + offset)) ?? planByMonth.get(addMonths(key, -11 + offset)) ?? 0).reduce((sum, value) => sum + value, 0)
      const info = calculateEffectiveSimplesTaxRate(rbt12, year)
      const tax = Math.round(revenue * info.aliquota_efetiva * 100) / 100
      return { competencia_ano: year, competencia_mes: month, competencia_str: key, receita_mes: Math.round(revenue * 100) / 100, rbt12: Math.round(rbt12 * 100) / 100, faixa: info.faixa, aliquota_nominal: info.aliquota_nominal, parcela_deduzir: info.parcela_deduzir, aliquota_efetiva: Math.round(info.aliquota_efetiva * 10000) / 10000, imposto_projetado: tax, data_vencimento: taxPaymentDate(year, month), regime_2027: regime, origem: actualByMonth.has(key) ? 'realizado' : planByMonth.has(key) ? 'plano_canônico' : 'sem_base' }
    })
    return NextResponse.json({ success: true, count: projections.length, projections, summary: { imposto_total: projections.reduce((sum, row) => sum + row.imposto_projetado, 0), receita_total: projections.reduce((sum, row) => sum + row.receita_mes, 0) }, metadata: { timezone: 'America/Sao_Paulo', regime_2027: regime, formula: '(RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12', cbs_ibs: regime === 'simples-nacional-puro' ? 'integrados ao Simples; nenhum adicional estimado' : 'não calculado sem alíquotas legais configuradas' } })
  } catch (error) {
    console.error('Failed to project tax:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao projetar impostos' }, { status: 500 })
  }
}
