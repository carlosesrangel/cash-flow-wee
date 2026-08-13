import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/olist/client', () => ({ olistFetch: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { olistFetch } from '@/lib/olist/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncOrders', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fetches order detail for each listed order and upserts order + items', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[{ id: 500 }]]) as never)
    vi.mocked(olistFetch).mockResolvedValue({
      id: 500,
      numeroPedido: 1001,
      situacao: 1,
      origemPedido: 0,
      data: '2026-06-01',
      dataPrevista: '2026-06-05',
      valorTotalPedido: 250.5,
      valorTotalProdutos: 250.5,
      cliente: { id: 77 },
      vendedor: { id: 1 },
      itens: [
        {
          produto: { id: 100, sku: 'ANEL-01', descricao: 'Anel Prata' },
          quantidade: 1,
          valorUnitario: 250.5,
        },
      ],
    })

    const orderUpsert = vi.fn().mockResolvedValue({
      data: [{ id: 'internal-order-uuid' }],
      error: null,
    })
    const orderSelect = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'internal-order-uuid' }], error: null }) })
    const itemsDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const itemsInsert = vi.fn().mockResolvedValue({ error: null })

    const from = vi.fn((table: string) => {
      if (table === 'olist_orders') {
        return { upsert: vi.fn().mockReturnValue({ select: orderSelect().select }) }
      }
      if (table === 'olist_order_items') {
        return { delete: itemsDelete, insert: itemsInsert }
      }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncOrders } = await import('@/lib/olist/sync/orders')
    const result = await syncOrders(ORG_ID)

    expect(result.received).toBe(1)
    expect(olistFetch).toHaveBeenCalledWith(ORG_ID, '/pedidos/500')
    expect(itemsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        order_id: 'internal-order-uuid',
        produto_olist_id: 100,
        sku: 'ANEL-01',
        quantidade: 1,
        valor_unitario: 250.5,
      }),
    ])
  })
})
