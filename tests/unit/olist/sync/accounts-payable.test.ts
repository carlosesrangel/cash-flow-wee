import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncAccountsPayable', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps and upserts accounts payable', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 900,
            situacao: 'aberto',
            data: '2026-06-01',
            dataVencimento: '2026-07-01',
            historico: 'Aluguel Julho',
            valor: 1500,
            saldo: 1500,
            numeroDocumento: 'DOC-1',
            cliente: { id: 55 },
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncAccountsPayable } = await import('@/lib/olist/sync/accounts-payable')
    const result = await syncAccountsPayable(ORG_ID)

    expect(result.received).toBe(1)
    expect(upsert.mock.calls[0][0][0]).toMatchObject({
      org_id: ORG_ID,
      olist_id: 900,
      situacao: 'aberto',
      valor: 1500,
      fornecedor_olist_id: 55,
    })
  })

  it('queries with dataInicialVencimento set windowDays back from today', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncAccountsPayable } = await import('@/lib/olist/sync/accounts-payable')
    await syncAccountsPayable(ORG_ID, { windowDays: 60 })

    const call = vi.mocked(paginateOlist).mock.calls[0]
    expect(call[1]).toBe('/contas-pagar')
    expect(call[2]).toHaveProperty('dataInicialVencimento')
  })
})
