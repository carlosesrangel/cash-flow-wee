import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ customerId: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { customerId } = await params
  const olistCustomerId = Number(customerId)
  if (!Number.isInteger(olistCustomerId)) return NextResponse.json({ error: 'Invalid customer id' }, { status: 400 })

  try {
    const admin = createAdminSupabaseClient()
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
    const itemsByOrder = new Map<string, typeof items>()
    for (const item of items ?? []) itemsByOrder.set(item.order_id as string, [...(itemsByOrder.get(item.order_id as string) ?? []), item])
    const history = (orders ?? []).flatMap((order) => (itemsByOrder.get(order.id as string) ?? []).map((item) => ({
      data: order.data,
      pedido: order.numero_pedido,
      produto: item.descricao_produto,
      sku: item.sku,
      quantidade: item.quantidade,
      valorUnitario: item.valor_unitario,
      valorTotal: Number(item.quantidade ?? 0) * Number(item.valor_unitario ?? 0),
      status: order.situacao,
    })))
    const revenue = (orders ?? []).reduce((sum, order) => sum + Number(order.valor_total_pedido ?? 0), 0)
    const units = history.reduce((sum, item) => sum + Number(item.quantidade ?? 0), 0)
    return NextResponse.json({ contact, summary: { revenue, units, orders: orders?.length ?? 0, averageOrderValue: orders?.length ? revenue / orders.length : 0, firstOrderDate: orders?.at(-1)?.data ?? null, lastOrderDate: orders?.[0]?.data ?? null }, history })
  } catch {
    return NextResponse.json({ error: 'Failed to load customer details' }, { status: 500 })
  }
}
