import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { loadCanonicalPlan } from '@/lib/planning/canonical-repository'
import { calculateEffectiveSimplesTaxRate } from '@/lib/tax/simples-nacional'
import { taxPaymentDate, type TaxObligation } from '@/lib/tax/engine'
import { toLocalDateParam } from '@/lib/integrations/date'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/ui/metric-card'
import { EmptyState } from '@/components/ui/empty-state'
import { TaxScheduleTable } from '@/components/tax/tax-schedule-table'
import { formatBRL } from '@/lib/format/currency'

type Order = { data: string | null; data_faturamento: string | null; valor_total_pedido: number | null; situacao: string | number | null }

function addMonths(key: string, offset: number) { const [year, month] = key.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1 + offset, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` }

export default async function ImpostosPage() {
  const member = await getCurrentMember()
  if (!member) return <EmptyState title="Acesso negado" description="Faça login para ver os impostos." />
  const client = await createServerSupabaseClient()
  const current = toLocalDateParam(new Date()).slice(0, 7)
  const [plans, orders] = await Promise.all([
    loadCanonicalPlan(member.orgId, addMonths(current, -12) + '-01', addMonths(current, 11) + '-01', client),
    fetchAllPages<Order>((start, end) => client.from('olist_orders').select('data, data_faturamento, valor_total_pedido, situacao').eq('org_id', member.orgId).range(start, end), 'Falha ao carregar vendas para impostos'),
  ])
  if (plans.length === 0 && orders.length === 0) return <div className="space-y-6"><PageHeader title="Impostos" description="Obrigações calculadas sobre a base financeira canônica" /><EmptyState title="Sem base de cálculo" description="Importe o planejamento factual e/ou sincronize pedidos válidos para calcular o Simples Nacional." /></div>
  const actualByMonth = new Map<string, number>()
  for (const order of orders) { const revenueDate = order.data_faturamento ?? order.data; if (revenueDate && Number(order.valor_total_pedido) > 0 && !['cancelado', 'cancelada', 'cancelled', 'canceled'].includes(String(order.situacao ?? '').toLowerCase())) actualByMonth.set(revenueDate.slice(0, 7), (actualByMonth.get(revenueDate.slice(0, 7)) ?? 0) + Number(order.valor_total_pedido)) }
  const planByMonth = new Map(plans.map((plan) => [plan.competenceMonth.slice(0, 7), plan.amount]))
  const schedule: TaxObligation[] = Array.from({ length: 12 }, (_, index) => { const key = addMonths(current, index); const year = Number(key.slice(0, 4)); const month = Number(key.slice(5, 7)); const revenue = actualByMonth.get(key) ?? planByMonth.get(key) ?? 0; const rbt12 = Array.from({ length: 12 }, (_, offset) => actualByMonth.get(addMonths(key, -11 + offset)) ?? planByMonth.get(addMonths(key, -11 + offset)) ?? 0).reduce((sum, value) => sum + value, 0); const info = calculateEffectiveSimplesTaxRate(rbt12, year); return { ano: year, mes: month, receitaProjetada: revenue, aliquota: info.aliquota_efetiva, aliquotaNominal: info.aliquota_nominal, parcelaDeduzir: info.parcela_deduzir, rbt12, faixa: info.faixa, valorImposto: Math.round(revenue * info.aliquota_efetiva * 100) / 100, vencimento: taxPaymentDate(year, month), origem: actualByMonth.has(key) ? 'realizado' : 'projetado' } })
  const today = toLocalDateParam(new Date()); const in60 = new Date(`${today}T00:00:00Z`); in60.setUTCDate(in60.getUTCDate() + 60); const in60Key = in60.toISOString().slice(0, 10); const upcoming = schedule.filter((item) => item.vencimento >= today && item.vencimento <= in60Key)
  return <div className="space-y-6"><PageHeader title="Impostos" subtitle="Base canônica: faturamento comercial + plano mensal" description="Simples Nacional com receita auferida por faturamento (data_faturamento; fallback explícito para data do pedido), fórmula de alíquota efetiva e vencimento no dia 20 do mês seguinte." /><div className="grid gap-4 md:grid-cols-3"><MetricCard label="Imposto nos próximos 60 dias" value={formatBRL(upcoming.reduce((sum, item) => sum + item.valorImposto, 0))} accentColor="red" footnote={`${upcoming.length} obrigação(ões)`} /><MetricCard label="Receita projetada (12 meses)" value={formatBRL(schedule.reduce((sum, item) => sum + item.receitaProjetada, 0))} accentColor="navy" /><MetricCard label="Imposto projetado (12 meses)" value={formatBRL(schedule.reduce((sum, item) => sum + item.valorImposto, 0))} accentColor="navy" /></div><Card><CardHeader><CardTitle className="text-lg">Calendário de Obrigações</CardTitle></CardHeader><CardContent><TaxScheduleTable schedule={schedule} today={today} /></CardContent></Card></div>
}
