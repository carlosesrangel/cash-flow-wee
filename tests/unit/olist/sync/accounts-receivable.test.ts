import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/olist/client', () => ({ olistFetch: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { olistFetch } from '@/lib/olist/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam } from '@/lib/integrations/date'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

function mockAdmin() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn().mockReturnValue({ upsert })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { upsert }
}

describe('syncAccountsReceivable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('fetches per-installment detail and upserts it alongside the listing fields', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 50,
            situacao: 'aberta',
            data: '2026-01-01',
            dataVencimento: '2026-02-01',
            historico: 'Ref. a NF nº 516, Giovana Dias (parcela 3/3)',
            valor: 380,
            saldo: 380,
            numeroDocumento: '000516/03',
            numeroBanco: 'B1',
            serieDocumento: 'S1',
            quantidadeParcelasAntecipadas: 0,
            cliente: { id: 7 },
          },
        ],
      ]) as never
    )
    vi.mocked(olistFetch).mockResolvedValue({
      id: 50,
      taxa: 16.34,
      valorPago: 0,
      dataLiquidacao: '',
      formaRecebimento: { id: 3, nome: 'Cartão de crédito' },
    })

    const { upsert } = mockAdmin()

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    const result = await syncAccountsReceivable(ORG_ID)

    expect(result.received).toBe(1)
    expect(olistFetch).toHaveBeenCalledWith(ORG_ID, '/contas-receber/50')
    const upsertedRow = upsert.mock.calls[0][0]
    expect(upsertedRow).toMatchObject({
      org_id: ORG_ID,
      olist_id: 50,
      cliente_olist_id: 7,
      taxa: 16.34,
      valor_pago: 0,
      data_liquidacao: null,
      forma_recebimento_id: 3,
      forma_recebimento_nome: 'Cartão de crédito',
    })
  })

  it('converts empty-string data/dataVencimento/dataLiquidacao to null before upserting', async () => {
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
    vi.mocked(olistFetch).mockResolvedValue({
      id: 51,
      taxa: null,
      valorPago: null,
      dataLiquidacao: '',
      formaRecebimento: null,
    })

    const { upsert } = mockAdmin()

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    await syncAccountsReceivable(ORG_ID)

    const upsertedRow = upsert.mock.calls[0][0]
    expect(upsertedRow).toMatchObject({
      data_emissao: null,
      data_vencimento: null,
      data_liquidacao: null,
      forma_recebimento_id: null,
      forma_recebimento_nome: null,
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
