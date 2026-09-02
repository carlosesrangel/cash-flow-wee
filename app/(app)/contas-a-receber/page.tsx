import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { classifyAccountsReceivable } from '@/lib/cash-flow/classify'
import { computeAgingBucket } from '@/lib/cash-flow/aging'
import { loadReconciledCashDates } from '@/lib/cash-flow/engine'
import { toLocalDateParam } from '@/lib/integrations/date'
import type { AccountsReceivableRow } from '@/components/cash-flow/accounts-receivable-table'
import { AccountsReceivableFilters } from '@/components/cash-flow/accounts-receivable-filters'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { fetchAllPages } from '@/lib/reconciliation/run'

export default async function ContasAReceberPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <EmptyState title="Acesso negado" description="Faça login para ver as contas a receber." />
  }

  const supabase = await createServerSupabaseClient()
  const { data: arRows, error } = await supabase
    .from('olist_accounts_receivable')
    .select('id, valor, saldo, situacao, data_emissao, data_vencimento, data_liquidacao, historico, numero_documento, cliente_olist_id, forma_recebimento_nome')
    .eq('org_id', member.orgId)
    .order('data_vencimento', { ascending: true })

  if (error) {
    throw new Error(`Falha ao carregar contas a receber: ${error.message}`)
  }

  const { data: contacts } = await supabase.from('olist_contacts').select('olist_id, nome')
  const contactNameByOlistId = new Map((contacts ?? []).map((c) => [c.olist_id as number, c.nome as string | null]))
  const [orders, items] = await Promise.all([
    fetchAllPages<{ id: string; cliente_olist_id: number | null; data: string | null }>((from, to) => supabase.from('olist_orders').select('id, cliente_olist_id, data').eq('org_id', member.orgId).range(from, to), 'Falha ao carregar pedidos para detalhamento de recebíveis'),
    fetchAllPages<{ order_id: string; descricao_produto: string | null }>((from, to) => supabase.from('olist_order_items').select('order_id, descricao_produto').eq('org_id', member.orgId).range(from, to), 'Falha ao carregar produtos para detalhamento de recebíveis'),
  ])
  const productsByOrder = new Map<string, string[]>()
  for (const item of items) if (item.descricao_produto) productsByOrder.set(item.order_id, [...(productsByOrder.get(item.order_id) ?? []), item.descricao_produto])
  const ordersByClient = new Map<number, Array<{ date: string; product: string }>>()
  for (const order of orders) if (order.cliente_olist_id && order.data && productsByOrder.has(order.id)) ordersByClient.set(order.cliente_olist_id, [...(ordersByClient.get(order.cliente_olist_id) ?? []), { date: order.data, product: [...new Set(productsByOrder.get(order.id))].join(', ') }])
  const closestProduct = (clientId: number | null, date: string | null) => {
    if (!clientId || !date) return null
    const target = new Date(date).getTime()
    return (ordersByClient.get(clientId) ?? []).map((candidate) => ({ ...candidate, diff: Math.abs(new Date(candidate.date).getTime() - target) })).filter((candidate) => candidate.diff <= 3 * 86400000).sort((a, b) => a.diff - b.diff)[0]?.product ?? null
  }

  const admin = createAdminSupabaseClient()
  const reconciledDates = await loadReconciledCashDates(admin, member.orgId)

  const today = toLocalDateParam(new Date())
  const rows: AccountsReceivableRow[] = (arRows ?? []).map((row) => {
    const classification = classifyAccountsReceivable(row, reconciledDates.get(row.id) ?? null)
    return {
      id: row.id,
      dataEmissao: row.data_emissao,
      numeroDocumento: row.numero_documento,
      historico: row.historico,
      clienteNome: row.cliente_olist_id ? (contactNameByOlistId.get(row.cliente_olist_id) ?? null) : null,
      valor: row.valor,
      dataVencimento: row.data_vencimento,
      formaPagamento: row.forma_recebimento_nome,
      parcela: row.historico?.match(/parcela\s+(\d+\/\d+)/i)?.[1] ?? null,
      produto: closestProduct(row.cliente_olist_id, row.data_emissao),
      documento: row.numero_documento,
      classification,
      agingBucket:
        classification.included && classification.bucket === 'contratado'
          ? computeAgingBucket(classification.date, today)
          : null,
    }
  })

  // Get unique clients for filter dropdown
  const clients = Array.from(
    new Map(rows.filter((r) => r.clienteNome).map((r) => [r.clienteNome!, r.clienteNome!])).values()
  ).sort()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas a Receber"
        subtitle="Recebíveis em Aberto"
        description="Acompanhe seus direitos financeiros e datas de recebimento"
      />
      <Card>
        <CardContent className="pt-6 space-y-6">
          <AccountsReceivableFilters rows={rows} clients={clients} today={today} />
        </CardContent>
      </Card>
    </div>
  )
}
