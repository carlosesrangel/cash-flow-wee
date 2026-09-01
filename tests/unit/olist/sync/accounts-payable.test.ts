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

describe('syncAccountsPayable', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('maps and upserts accounts payable', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 40,
            situacao: 'aberta',
            data: '2026-01-01',
            dataVencimento: '2026-02-01',
            historico: 'Fatura',
            valor: 100,
            saldo: 100,
            numeroDocumento: 'D1',
            serieDocumento: 'S1',
            cliente: { id: 5 },
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(olistFetch).mockResolvedValue({ id: 40, valorPago: 0, dataLiquidacao: null, categoria: { id: 7, descricao: 'Fornecedores' } })
    const from = vi.fn().mockImplementation((table: string) => table === 'olist_accounts_payable'
      ? { select: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) })) })), upsert }
      : { upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncAccountsPayable } = await import('@/lib/olist/sync/accounts-payable')
    const result = await syncAccountsPayable(ORG_ID)

    expect(result.received).toBe(1)
    const upsertedRows = upsert.mock.calls[0][0]
    expect(upsertedRows[0]).toMatchObject({ org_id: ORG_ID, olist_id: 40, fornecedor_olist_id: 5 })
  })

  it('converts empty-string data/dataVencimento to null before upserting', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 41,
            situacao: 'aberta',
            data: '',
            dataVencimento: '',
            historico: 'Sem datas',
            valor: 50,
            saldo: 50,
            numeroDocumento: 'D2',
            serieDocumento: 'S2',
            cliente: null,
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(olistFetch).mockResolvedValue({ id: 41, valorPago: 0, dataLiquidacao: null, categoria: null })
    const from = vi.fn().mockImplementation((table: string) => table === 'olist_accounts_payable'
      ? { select: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) })) })), upsert }
      : { upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncAccountsPayable } = await import('@/lib/olist/sync/accounts-payable')
    await syncAccountsPayable(ORG_ID)

    const upsertedRows = upsert.mock.calls[0][0]
    expect(upsertedRows[0]).toMatchObject({
      data_emissao: null,
      data_vencimento: null,
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

  it('defaults to a 90-day window when windowDays is not provided', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncAccountsPayable } = await import('@/lib/olist/sync/accounts-payable')
    await syncAccountsPayable(ORG_ID)

    const call = vi.mocked(paginateOlist).mock.calls[0]
    const expectedStart = new Date()
    expectedStart.setDate(expectedStart.getDate() - 90)
    expect((call[2] as { dataInicialVencimento: string }).dataInicialVencimento).toBe(
      toLocalDateParam(expectedStart)
    )
  })

  it('keeps detail fields when an existing row is unchanged and already categorized', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[
      { id: 42, situacao: 'aberto', data: '2026-01-01', dataVencimento: '2026-02-01', historico: 'Fatura', valor: 100, saldo: 100, numeroDocumento: 'D3', serieDocumento: null, cliente: null },
    ]]) as never)
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const select = vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [{ olist_id: 42, situacao: 'aberto', data_vencimento: '2026-02-01', valor: 100, saldo: 100, categoria_id: 8, categoria: 'Impostos', valor_pago: 0, data_liquidacao: null, raw: { preserved: true } }], error: null }) })) }))
    const from = vi.fn().mockReturnValue({ select, upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncAccountsPayable } = await import('@/lib/olist/sync/accounts-payable')
    await syncAccountsPayable(ORG_ID)

    expect(olistFetch).not.toHaveBeenCalled()
    expect(upsert.mock.calls[0][0][0]).toMatchObject({ categoria_id: 8, categoria: 'Impostos', raw: { preserved: true } })
  })
})
