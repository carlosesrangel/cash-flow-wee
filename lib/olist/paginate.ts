import { olistFetch } from '@/lib/olist/client'

type PaginatedResponse<T> = {
  itens: T[]
  paginacao: { limit: number; offset: number; total: number }
}

export async function* paginateOlist<T>(
  orgId: string,
  path: string,
  baseQuery: Record<string, string | number | undefined>,
  pageSize = 100
): AsyncGenerator<T[]> {
  let offset = 0

  while (true) {
    const page = await olistFetch<PaginatedResponse<T>>(orgId, path, {
      ...baseQuery,
      limit: pageSize,
      offset,
    })

    yield page.itens

    offset += pageSize
    const total = page.paginacao?.total
    if (page.itens.length === 0 || !Number.isFinite(total) || offset >= total) break
  }
}
