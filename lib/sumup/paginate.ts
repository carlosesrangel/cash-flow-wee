import { sumupFetch } from '@/lib/sumup/client'

type SumupLink = { rel: string; href: string }
type HypermediaResponse<T> = { items: T[]; links: SumupLink[] }

export async function* paginateSumupTransactions<T>(
  merchantCode: string,
  baseQuery: Record<string, string | number | undefined>,
  pageSize = 100
): AsyncGenerator<T[]> {
  const path = `/v2.1/merchants/${merchantCode}/transactions/history`
  let query: Record<string, string | number | undefined> | undefined = { ...baseQuery, limit: pageSize }

  while (query) {
    const page: HypermediaResponse<T> = await sumupFetch<HypermediaResponse<T>>(path, query)

    yield page.items

    if (page.items.length === 0) break

    const nextLink = page.links?.find((link) => link.rel === 'next')
    if (!nextLink) break

    // SumUp's `next` link `href` is a bare query string (no path/scheme),
    // e.g. "limit=1&merchant_code=...&oldest_ref=...". Parse it as query
    // params and keep hitting the same fixed path for every page.
    query = Object.fromEntries(new URLSearchParams(nextLink.href))
  }
}
