import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/sumup/client', () => ({ sumupFetch: vi.fn() }))
import { sumupFetch } from '@/lib/sumup/client'

describe('paginateSumupTransactions', () => {
  afterEach(() => vi.clearAllMocks())

  it('follows the next link across pages until none remains, parsing the real bare-query-string href shape', async () => {
    // Real confirmed shape from the live SumUp API: the `next` link's href is
    // a bare query string with no leading slash, path, or scheme — e.g.
    // "limit=1&merchant_code=MC3QQU9T&oldest_ref=...&order=ascending&skip_tx_result=true"
    vi.mocked(sumupFetch)
      .mockResolvedValueOnce({
        items: [{ transaction_code: 'A' }, { transaction_code: 'B' }],
        links: [{ rel: 'next', href: 'limit=2&merchant_code=MC-TEST&oldest_ref=B&order=ascending&skip_tx_result=true' }],
      })
      .mockResolvedValueOnce({
        items: [{ transaction_code: 'C' }],
        links: [],
      })

    const { paginateSumupTransactions } = await import('@/lib/sumup/paginate')
    const pages: unknown[] = []
    for await (const page of paginateSumupTransactions('MC-TEST', {}, 2)) {
      pages.push(page)
    }

    expect(pages).toEqual([
      [{ transaction_code: 'A' }, { transaction_code: 'B' }],
      [{ transaction_code: 'C' }],
    ])
    expect(sumupFetch).toHaveBeenCalledTimes(2)
    expect(sumupFetch).toHaveBeenNthCalledWith(
      1,
      '/v2.1/merchants/MC-TEST/transactions/history',
      { limit: 2 }
    )
    expect(sumupFetch).toHaveBeenNthCalledWith(
      2,
      '/v2.1/merchants/MC-TEST/transactions/history',
      {
        limit: '2',
        merchant_code: 'MC-TEST',
        oldest_ref: 'B',
        order: 'ascending',
        skip_tx_result: 'true',
      }
    )
  })

  it('stops after the first page when there is no next link', async () => {
    vi.mocked(sumupFetch).mockResolvedValueOnce({ items: [{ transaction_code: 'A' }], links: [] })

    const { paginateSumupTransactions } = await import('@/lib/sumup/paginate')
    const pages: unknown[] = []
    for await (const page of paginateSumupTransactions('MC-TEST', {}, 100)) {
      pages.push(page)
    }

    expect(pages).toEqual([[{ transaction_code: 'A' }]])
    expect(sumupFetch).toHaveBeenCalledTimes(1)
  })

  it('stops when a page comes back empty even if a next link is somehow present', async () => {
    vi.mocked(sumupFetch).mockResolvedValueOnce({
      items: [],
      links: [{ rel: 'next', href: 'limit=100' }],
    })

    const { paginateSumupTransactions } = await import('@/lib/sumup/paginate')
    const pages: unknown[] = []
    for await (const page of paginateSumupTransactions('MC-TEST', {}, 100)) {
      pages.push(page)
    }

    expect(pages).toEqual([[]])
    expect(sumupFetch).toHaveBeenCalledTimes(1)
  })

  it('terminates instead of looping forever when the next link is self-referential', async () => {
    vi.mocked(sumupFetch).mockResolvedValue({
      items: [{ transaction_code: 'A' }],
      links: [{ rel: 'next', href: 'limit=1&oldest_ref=A' }],
    })

    const { paginateSumupTransactions } = await import('@/lib/sumup/paginate')
    const pages: unknown[] = []
    for await (const page of paginateSumupTransactions('MC-TEST', {}, 1)) {
      pages.push(page)
      if (pages.length > 10) throw new Error('generator did not terminate on repeated href')
    }

    // First page fetched with the href unseen (it gets recorded), second page
    // fetched by following that href; on the second page the same href is
    // seen again, so the loop breaks before a third fetch.
    expect(pages).toEqual([[{ transaction_code: 'A' }], [{ transaction_code: 'A' }]])
    expect(sumupFetch).toHaveBeenCalledTimes(2)
  })
})
