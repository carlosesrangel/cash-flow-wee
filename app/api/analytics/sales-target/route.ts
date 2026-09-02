import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { loadCanonicalPlan } from '@/lib/planning/canonical-repository'
import { toLocalDateParam } from '@/lib/integrations/date'

export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const client = await createServerSupabaseClient()
  const month = toLocalDateParam(new Date()).slice(0, 7)
  const [plans, orders] = await Promise.all([
    loadCanonicalPlan(member.orgId, `${month}-01`, `${month}-01`, client),
    fetchAllPages<{ data_faturamento: string | null; valor_total_pedido: number | null; situacao: string | number | null }>((from, to) => client.from('olist_orders').select('data_faturamento, valor_total_pedido, situacao').eq('org_id', member.orgId).range(from, to), 'Falha ao carregar faturamento da meta'),
  ])
  const cancelled = new Set(['cancelado', 'cancelada', 'cancelled', 'canceled'])
  const valid = orders.filter((order) => order.data_faturamento && Number(order.valor_total_pedido ?? 0) > 0 && !cancelled.has(String(order.situacao ?? '').toLowerCase()))
  const monthOrders = valid.filter((order) => order.data_faturamento!.slice(0, 7) === month)
  const target = Number(plans[0]?.amount ?? 0)
  const realized = monthOrders.reduce((sum, order) => sum + Number(order.valor_total_pedido ?? 0), 0)
  const availableDates = valid.map((order) => order.data_faturamento!.slice(0, 10)).sort()
  return NextResponse.json({ month, target, realizedSales: Math.round(realized * 100) / 100, targetGap: Math.round((target - realized) * 100) / 100, achievementPercent: target > 0 ? Math.round((realized / target) * 10000) / 100 : null, billedThrough: availableDates.at(-1) ?? null, billedOrders: valid.length, billedOrdersThisMonth: monthOrders.length, source: 'Tiny/Olist data_faturamento' })
}
