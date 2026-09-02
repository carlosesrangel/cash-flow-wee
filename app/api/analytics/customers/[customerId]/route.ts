import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { customerId } = await params
  const olistCustomerId = Number(customerId)
  if (!Number.isInteger(olistCustomerId)) return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 })

  try {
    const admin = await createServerSupabaseClient()
    const [{ data: contact }, { data: orders, error: ordersError }] = await Promise.all([
      admin.from('olist_contacts').select('nome, email, telefone, celular, cpf_cnpj, endereco').eq('org_id', member.orgId).eq('olist_id', olistCustomerId).maybeSingle(),
      admin.from('olist_orders').select('id, numero_pedido, data, situacao, cliente_olist_id, valor_total_pedido').eq('org_id', member.orgId).eq('cliente_olist_id', olistCustomerId).order('data', { ascending: false }),
    ])
    if (ordersError) throw ordersError
    const orderIds = (orders ?? []).map((order) => order.id as string)
    const { data: items, error: itemsError } = orderIds.length === 0
      ? { data: [], error: null }
      : await admin.from('olist_order_items').select('order_id, descricao_produto, sku, quantidade, valor_unitario').eq('org_id', member.orgId).in('order_id', orderIds)
    if (itemsError) throw itemsError
    const { data: receivables, error: receivablesError } = await admin.from('olist_accounts_receivable').select('data_emissao, forma_recebimento_nome, historico').eq('org_id', member.orgId).eq('cliente_olist_id', olistCustomerId)
    if (receivablesError) throw receivablesError
    const itemsByOrder = new Map<string, typeof items>()
    for (const item of items ?? []) itemsByOrder.set(item.order_id as string, [...(itemsByOrder.get(item.order_id as string) ?? []), item])
    const history = (orders ?? []).map((order) => {
      const orderItems = itemsByOrder.get(order.id as string) ?? []
      const closestReceivable = (receivables ?? []).map((row) => ({ ...row, diff: order.data && row.data_emissao ? Math.abs(new Date(order.data).getTime() - new Date(row.data_emissao).getTime()) : Infinity })).filter((row) => row.diff <= 5 * 86400000).sort((a, b) => a.diff - b.diff)[0]
      return {
        data: order.data,
        pedido: order.numero_pedido,
        status: order.situacao,
        valorTotalPedido: order.valor_total_pedido,
        formaPagamento: closestReceivable?.forma_recebimento_nome ?? null,
        parcelas: closestReceivable?.historico?.match(/parcela\s+(\d+\/\d+)/i)?.[1] ?? null,
        itens: orderItems.map((item) => ({ produto: item.descricao_produto, sku: item.sku, quantidade: item.quantidade, valorUnitario: item.valor_unitario, valorTotal: Number(item.quantidade ?? 0) * Number(item.valor_unitario ?? 0) })),
      }
    })
    const revenue = (orders ?? []).reduce((sum, order) => sum + Number(order.valor_total_pedido ?? 0), 0)
    const units = history.reduce((sum, order) => sum + order.itens.reduce((itemSum, item) => itemSum + Number(item.quantidade ?? 0), 0), 0)
    return NextResponse.json({ contact, summary: { revenue, units, orders: orders?.length ?? 0, averageOrderValue: orders?.length ? revenue / orders.length : 0, firstOrderDate: orders?.at(-1)?.data ?? null, lastOrderDate: orders?.[0]?.data ?? null }, history })
  } catch {
    return NextResponse.json({ error: 'Failed to load customer details' }, { status: 500 })
  }
}
