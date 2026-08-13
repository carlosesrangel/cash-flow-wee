import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncPaymentMethods', () => {
  afterEach(() => vi.restoreAllMocks())

  it('upserts every payment method and reports counts', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([[{ id: 1, nome: 'Boleto', situacao: 'A' }]]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncPaymentMethods } = await import('@/lib/olist/sync/payment-methods')
    const result = await syncPaymentMethods(ORG_ID)

    expect(result.received).toBe(1)
    expect(from).toHaveBeenCalledWith('olist_payment_methods')
  })
})
