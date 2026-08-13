import { paginateOlist } from '@/lib/olist/paginate'
import { olistFetch } from '@/lib/olist/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toOlistDateParam } from '@/lib/olist/date'

type OlistOrderListItem = { id: number; dataCriacao?: string | null }

type OlistOrderDetail = {
  id: number
  numeroPedido: number | null
  situacao: number | null
  origemPedido: number | null
  data: string | null
  dataPrevista: string | null
  dataEntrega: string | null
  dataFaturamento: string | null
  idNotaFiscal: number | null
  valorTotalProdutos: number | null
  valorTotalPedido: number | null
  valorDesconto: number | null
  valorFrete: number | null
  valorOutrasDespesas: number | null
  numeroOrdemCompra: string | null
  observacoes: string | null
  observacoesInternas: string | null
  cliente?: { id: number } | null
  vendedor?: { id: number } | null
  itens?: Array<{
    produto?: { id: number; sku?: string | null; descricao?: string | null } | null
    quantidade: number
    valorUnitario: number
    infoAdicional?: string | null
  }> | null
}

export async function syncOrders(
  orgId: string,
  options: { since?: Date } = {}
): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const query = options.since ? { dataAtualizacao: toOlistDateParam(options.since) } : {}

  for await (const page of paginateOlist<OlistOrderListItem>(orgId, '/pedidos', query)) {
    for (const listItem of page) {
      received += 1

      const detail = await olistFetch<OlistOrderDetail>(orgId, `/pedidos/${listItem.id}`)

      const { data: upserted, error: orderError } = await admin
        .from('olist_orders')
        .upsert(
          {
            org_id: orgId,
            olist_id: detail.id,
            numero_pedido: detail.numeroPedido,
            situacao: detail.situacao,
            origem_pedido: detail.origemPedido,
            data: detail.data,
            data_prevista: detail.dataPrevista,
            data_entrega: detail.dataEntrega,
            data_faturamento: detail.dataFaturamento,
            id_nota_fiscal: detail.idNotaFiscal,
            valor_total_produtos: detail.valorTotalProdutos,
            valor_total_pedido: detail.valorTotalPedido,
            valor_desconto: detail.valorDesconto,
            valor_frete: detail.valorFrete,
            valor_outras_despesas: detail.valorOutrasDespesas,
            numero_ordem_compra: detail.numeroOrdemCompra,
            observacoes: detail.observacoes,
            observacoes_internas: detail.observacoesInternas,
            cliente_olist_id: detail.cliente?.id ?? null,
            vendedor_olist_id: detail.vendedor?.id ?? null,
            data_criacao_olist: listItem.dataCriacao ?? null,
            raw: detail,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,olist_id' }
        )
        .select('id')

      if (orderError || !upserted?.[0]) {
        throw new Error(`Failed to upsert olist_orders ${detail.id}: ${orderError?.message ?? 'no row returned'}`)
      }

      const orderId = upserted[0].id as string

      const { error: deleteError } = await admin.from('olist_order_items').delete().eq('order_id', orderId)

      if (deleteError) {
        throw new Error(`Failed to delete olist_order_items for order ${detail.id}: ${deleteError.message}`)
      }

      const items = detail.itens ?? []
      if (items.length > 0) {
        const { error: itemsError } = await admin.from('olist_order_items').insert(
          items.map((item) => ({
            org_id: orgId,
            order_id: orderId,
            produto_olist_id: item.produto?.id ?? null,
            descricao_produto: item.produto?.descricao ?? null,
            sku: item.produto?.sku ?? null,
            quantidade: item.quantidade,
            valor_unitario: item.valorUnitario,
            info_adicional: item.infoAdicional ?? null,
            raw: item,
            synced_at: new Date().toISOString(),
          }))
        )

        if (itemsError) {
          throw new Error(`Failed to insert olist_order_items for order ${detail.id}: ${itemsError.message}`)
        }
      }
    }
  }

  return { received, created: received, updated: 0 }
}
