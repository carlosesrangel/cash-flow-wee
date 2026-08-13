import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam } from '@/lib/integrations/date'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncAccountsReceivable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('maps and upserts accounts receivable', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 50,
            situacao: 'aberta',
            data: '2026-01-01',
            dataVencimento: '2026-02-01',
            historico: 'Recebimento',
            valor: 200,
            saldo: 200,
            numeroDocumento: 'D1',
            numeroBanco: 'B1',
            serieDocumento: 'S1',
            quantidadeParcelasAntecipadas: 0,
            cliente: { id: 7 },
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    const result = await syncAccountsReceivable(ORG_ID)

    expect(result.received).toBe(1)
    const upsertedRows = upsert.mock.calls[0][0]
    expect(upsertedRows[0]).toMatchObject({ org_id: ORG_ID, olist_id: 50, cliente_olist_id: 7 })
  })

  it('converts empty-string data/dataVencimento to null before upserting', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 51,
            situacao: 'aberta',
            data: '',
            dataVencimento: '',
            historico: 'Sem datas',
            valor: 20,
            saldo: 20,
            numeroDocumento: 'D2',
            numeroBanco: 'B2',
            serieDocumento: null,
            quantidadeParcelasAntecipadas: 0,
            cliente: null,
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    await syncAccountsReceivable(ORG_ID)

    const upsertedRows = upsert.mock.calls[0][0]
    expect(upsertedRows[0]).toMatchObject({
      data_emissao: null,
      data_vencimento: null,
    })
  })

  it('defaults to a 90-day window when windowDays is not provided', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    await syncAccountsReceivable(ORG_ID)

    const call = vi.mocked(paginateOlist).mock.calls[0]
    expect(call[1]).toBe('/contas-receber')

    const expectedStart = new Date()
    expectedStart.setDate(expectedStart.getDate() - 90)
    expect((call[2] as { dataInicialVencimento: string }).dataInicialVencimento).toBe(
      toLocalDateParam(expectedStart)
    )
  })

  it('accepts an overridable windowDays option', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    await syncAccountsReceivable(ORG_ID, { windowDays: 60 })

    const call = vi.mocked(paginateOlist).mock.calls[0]

    const expectedStart60 = new Date()
    expectedStart60.setDate(expectedStart60.getDate() - 60)
    expect((call[2] as { dataInicialVencimento: string }).dataInicialVencimento).toBe(
      toLocalDateParam(expectedStart60)
    )
  })
})
