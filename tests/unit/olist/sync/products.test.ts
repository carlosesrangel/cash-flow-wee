import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncProducts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps and upserts products', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 30,
            sku: 'SKU-1',
            descricao: 'Produto Um',
            tipo: 'P',
            situacao: 'A',
            unidade: 'UN',
            gtin: null,
            dataCriacao: '2026-01-01',
            dataAlteracao: '2026-01-05',
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncProducts } = await import('@/lib/olist/sync/products')
    const result = await syncProducts(ORG_ID)

    expect(result.received).toBe(1)
    const upsertedRows = upsert.mock.calls[0][0]
    expect(upsertedRows[0]).toMatchObject({ org_id: ORG_ID, olist_id: 30, sku: 'SKU-1' })
  })

  it('converts empty-string dataCriacao/dataAlteracao to null before upserting', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 31,
            sku: 'SKU-2',
            descricao: 'Produto Sem Datas',
            tipo: 'P',
            situacao: 'A',
            unidade: 'UN',
            gtin: null,
            dataCriacao: '',
            dataAlteracao: '',
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncProducts } = await import('@/lib/olist/sync/products')
    await syncProducts(ORG_ID)

    const upsertedRows = upsert.mock.calls[0][0]
    expect(upsertedRows[0]).toMatchObject({
      data_criacao_olist: null,
      data_atualizacao_olist: null,
    })
  })
})
