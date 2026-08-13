import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncContacts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps and upserts contacts, tolerating missing optional fields', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 10,
            nome: 'Cliente Um',
            codigo: 'C001',
            situacao: 'A',
            statusCrm: 'C',
            dataCriacao: '2026-01-01',
            dataAtualizacao: '2026-01-05',
            vendedor: { id: 1, nome: 'Ana' },
          },
          {
            id: 11,
            nome: 'Cliente Sem Vendedor',
            situacao: 'B',
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncContacts } = await import('@/lib/olist/sync/contacts')
    const result = await syncContacts(ORG_ID)

    expect(result.received).toBe(2)
    const upsertedRows = upsert.mock.calls[0][0]
    expect(upsertedRows[0]).toMatchObject({ org_id: ORG_ID, olist_id: 10, vendedor_olist_id: 1 })
    expect(upsertedRows[1]).toMatchObject({ org_id: ORG_ID, olist_id: 11, vendedor_olist_id: null })
  })

  it('converts empty-string dataCriacao/dataAtualizacao to null before upserting', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 20,
            nome: 'Cliente Sem Datas',
            situacao: 'A',
            dataCriacao: '',
            dataAtualizacao: '',
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncContacts } = await import('@/lib/olist/sync/contacts')
    await syncContacts(ORG_ID)

    const upsertedRows = upsert.mock.calls[0][0]
    expect(upsertedRows[0]).toMatchObject({
      data_criacao_olist: null,
      data_atualizacao_olist: null,
    })
  })

  it('passes dataAtualizacao to paginateOlist when since is provided', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncContacts } = await import('@/lib/olist/sync/contacts')
    // Midday UTC keeps the same calendar date in both UTC and America/Sao_Paulo,
    // so this test only checks pass-through; timezone-edge correctness is
    // covered separately in tests/unit/olist/date.test.ts.
    await syncContacts(ORG_ID, { since: new Date('2026-06-01T12:00:00Z') })

    expect(paginateOlist).toHaveBeenCalledWith(
      ORG_ID,
      '/contatos',
      expect.objectContaining({ dataAtualizacao: '2026-06-01 00:00:00' })
    )
  })
})
