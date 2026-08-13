import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/sumup/client', () => ({ sumupFetch: vi.fn() }))
import { sumupFetch } from '@/lib/sumup/client'

describe('paginateSumupTransactions', () => {
  afterEach(() => vi.clearAllMocks())

  it('follows the next link across pages until none remains', async () => {
    vi.mocked(sumupFetch)
      .mockResolvedValueOnce({
        items: [{ transaction_code: 'A' }, { transaction_code: 'B' }],
        links: [{ rel: 'next', href: '/v2.1/merchants/MC-TEST/transactions/history?limit=2&oldest_ref=B' }],
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
      '/v2.1/merchants/MC-TEST/transactions/history?limit=2&oldest_ref=B',
      undefined
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
      links: [{ rel: 'next', href: '/v2.1/merchants/MC-TEST/transactions/history?limit=100' }],
    })

    const { paginateSumupTransactions } = await import('@/lib/sumup/paginate')
    const pages: unknown[] = []
    for await (const page of paginateSumupTransactions('MC-TEST', {}, 100)) {
      pages.push(page)
    }

    expect(pages).toEqual([[]])
    expect(sumupFetch).toHaveBeenCalledTimes(1)
  })
})
