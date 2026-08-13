import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/client', () => ({ olistFetch: vi.fn() }))
import { olistFetch } from '@/lib/olist/client'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('paginateOlist', () => {
  // Note: vi.restoreAllMocks() does not clear call counts for vi.fn() created inside a
  // vi.mock() factory in this Vitest version, which leaves stale call counts across tests
  // in this file (verified via isolated repro). vi.resetAllMocks() clears calls & implementation
  // reliably, so it's used here instead of the brief's restoreAllMocks().
  afterEach(() => vi.resetAllMocks())

  it('yields every page until offset reaches the total', async () => {
    vi.mocked(olistFetch)
      .mockResolvedValueOnce({ itens: [{ id: 1 }, { id: 2 }], paginacao: { limit: 2, offset: 0, total: 3 } })
      .mockResolvedValueOnce({ itens: [{ id: 3 }], paginacao: { limit: 2, offset: 2, total: 3 } })

    const { paginateOlist } = await import('@/lib/olist/paginate')
    const pages: unknown[] = []
    for await (const page of paginateOlist(ORG_ID, '/contatos', {}, 2)) {
      pages.push(page)
    }

    expect(pages).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }]])
    expect(olistFetch).toHaveBeenCalledTimes(2)
    expect(olistFetch).toHaveBeenNthCalledWith(1, ORG_ID, '/contatos', { limit: 2, offset: 0 })
    expect(olistFetch).toHaveBeenNthCalledWith(2, ORG_ID, '/contatos', { limit: 2, offset: 2 })
  })

  it('stops immediately when the first page is empty', async () => {
    vi.mocked(olistFetch).mockResolvedValueOnce({ itens: [], paginacao: { limit: 100, offset: 0, total: 0 } })

    const { paginateOlist } = await import('@/lib/olist/paginate')
    const pages: unknown[] = []
    for await (const page of paginateOlist(ORG_ID, '/contatos', {}, 100)) {
      pages.push(page)
    }

    expect(pages).toEqual([[]])
    expect(olistFetch).toHaveBeenCalledTimes(1)
  })

  it('terminates instead of hanging when paginacao.total is malformed', async () => {
    // Every call (not just the first) returns a non-empty page with a malformed total, so if the
    // termination guard regressed, the generator would loop forever calling olistFetch.
    vi.mocked(olistFetch).mockResolvedValue({
      itens: [{ id: 1 }],
      paginacao: { limit: 10, offset: 0, total: undefined as unknown as number },
    })

    const { paginateOlist } = await import('@/lib/olist/paginate')

    const collectAll = async () => {
      const pages: unknown[] = []
      for await (const page of paginateOlist(ORG_ID, '/contatos', {}, 10)) {
        pages.push(page)
      }
      return pages
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('paginateOlist did not terminate within 1000ms')), 1000)
    )

    const pages = await Promise.race([collectAll(), timeout])

    expect(pages).toEqual([[{ id: 1 }]])
    expect(olistFetch).toHaveBeenCalledTimes(1)
  })
})
