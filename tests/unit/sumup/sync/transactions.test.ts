import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/sumup/paginate', () => ({ paginateSumupTransactions: vi.fn() }))
vi.mock('@/lib/sumup/client', () => ({
  sumupFetch: vi.fn(),
  getSumupMerchantCode: vi.fn(() => 'MC-TEST'),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateSumupTransactions } from '@/lib/sumup/paginate'
import { sumupFetch } from '@/lib/sumup/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncSumupTransactions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fetches detail per transaction, upserts the transaction, replaces its events', async () => {
    vi.mocked(paginateSumupTransactions).mockReturnValue(
      fakePages([[{ transaction_code: 'TX1' }]]) as never
    )
    vi.mocked(sumupFetch).mockResolvedValue({
      transaction_code: 'TX1',
      transaction_id: 'uuid-abc',
      amount: 100.5,
      currency: 'BRL',
      timestamp: '2026-06-01T12:00:00Z',
      status: 'SUCCESSFUL',
      payment_type: 'ECOM',
      payout_date: '',
      transaction_events: [
        {
          id: 'ev1',
          event_type: 'PAYOUT',
          status: 'SUCCESSFUL',
          amount: 100.5,
          date: '2026-06-05',
          due_date: '',
          installment_number: 1,
        },
      ],
    })

    const txSelect = vi.fn().mockResolvedValue({ data: [{ id: 'internal-tx-uuid' }], error: null })
    const txUpsert = vi.fn().mockReturnValue({ select: txSelect })
    const eventsDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const eventsInsert = vi.fn().mockResolvedValue({ error: null })

    const from = vi.fn((table: string) => {
      if (table === 'sumup_transactions') return { upsert: txUpsert }
      if (table === 'sumup_transaction_events') return { delete: eventsDelete, insert: eventsInsert }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncSumupTransactions } = await import('@/lib/sumup/sync/transactions')
    const result = await syncSumupTransactions(ORG_ID)

    expect(result).toEqual({ received: 1 })
    expect(sumupFetch).toHaveBeenCalledWith('/v2.1/merchants/MC-TEST/transactions', {
      transaction_code: 'TX1',
    })
    expect(txUpsert.mock.calls[0][0]).toMatchObject({
      org_id: ORG_ID,
      transaction_code: 'TX1',
      payout_date: null,
    })
    expect(eventsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        transaction_id: 'internal-tx-uuid',
        event_type: 'PAYOUT',
        due_date: null,
      }),
    ])
  })

  it('throws before inserting new events when deleting old ones fails', async () => {
    vi.mocked(paginateSumupTransactions).mockReturnValue(
      fakePages([[{ transaction_code: 'TX2' }]]) as never
    )
    vi.mocked(sumupFetch).mockResolvedValue({
      transaction_code: 'TX2',
      amount: 50,
      currency: 'BRL',
      timestamp: '2026-06-01T00:00:00Z',
      status: 'SUCCESSFUL',
      transaction_events: [],
    })

    const txSelect = vi.fn().mockResolvedValue({ data: [{ id: 'internal-tx-2' }], error: null })
    const txUpsert = vi.fn().mockReturnValue({ select: txSelect })
    const eventsDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: 'delete boom' } }) })
    const eventsInsert = vi.fn()

    const from = vi.fn((table: string) => {
      if (table === 'sumup_transactions') return { upsert: txUpsert }
      if (table === 'sumup_transaction_events') return { delete: eventsDelete, insert: eventsInsert }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncSumupTransactions } = await import('@/lib/sumup/sync/transactions')
    await expect(syncSumupTransactions(ORG_ID)).rejects.toThrow(/delete boom/)
    expect(eventsInsert).not.toHaveBeenCalled()
  })
})
