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
  const seenHrefs = new Set<string>()

  while (query) {
    const page: HypermediaResponse<T> = await sumupFetch<HypermediaResponse<T>>(path, query)

    yield page.items

    if (page.items.length === 0) break

    const nextLink = page.links?.find((link) => link.rel === 'next')
    if (!nextLink) break

    if (seenHrefs.has(nextLink.href)) break
    seenHrefs.add(nextLink.href)

    // SumUp's `next` link `href` is a bare query string (no path/scheme),
    // e.g. "limit=1&merchant_code=...&oldest_ref=...". Parse it as query
    // params and keep hitting the same fixed path for every page.
    //
    // The href is server-composed from a fixed set of params (it carries
    // `merchant_code`/`skip_tx_result`, which the caller never sent) — it does
    // NOT echo back the caller's filters. So merge it over `baseQuery` instead
    // of replacing it: filters like `changes_since` survive across every page,
    // while the href's own cursor params win on key collisions.
    query = { ...baseQuery, ...Object.fromEntries(new URLSearchParams(nextLink.href)) }
  }
}
