import { sumupFetch } from '@/lib/sumup/client'

type SumupLink = { rel: string; href: string }
type HypermediaResponse<T> = { items: T[]; links: SumupLink[] }

export async function* paginateSumupTransactions<T>(
  merchantCode: string,
  baseQuery: Record<string, string | number | undefined>,
  pageSize = 100
): AsyncGenerator<T[]> {
  let path: string | null = `/v2.1/merchants/${merchantCode}/transactions/history`
  let query: Record<string, string | number | undefined> | undefined = { ...baseQuery, limit: pageSize }

  while (path) {
    const page: HypermediaResponse<T> = await sumupFetch<HypermediaResponse<T>>(path, query)

    yield page.items

    if (page.items.length === 0) break

    const nextLink = page.links?.find((link) => link.rel === 'next')
    if (!nextLink) break

    path = nextLink.href
    query = undefined
  }
}
