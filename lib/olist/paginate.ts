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
    if (offset >= page.paginacao.total) break
  }
}
