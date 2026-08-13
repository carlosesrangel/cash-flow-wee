import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncSellers', () => {
  afterEach(() => vi.restoreAllMocks())

  it('upserts every seller across all pages and reports counts', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [{ id: 1, nome: 'Ana', situacao: 'A' }],
        [{ id: 2, nome: 'Bruno', situacao: 'A' }],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null, count: 1 })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncSellers } = await import('@/lib/olist/sync/sellers')
    const result = await syncSellers(ORG_ID)

    expect(result.received).toBe(2)
    expect(from).toHaveBeenCalledWith('olist_sellers')
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert.mock.calls[0][0]).toMatchObject([
      { org_id: ORG_ID, olist_id: 1, nome: 'Ana', situacao: 'A' },
    ])
  })
})
