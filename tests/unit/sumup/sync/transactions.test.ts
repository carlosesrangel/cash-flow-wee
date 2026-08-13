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

  it('fetches detail per transaction, upserts the transaction, replaces its events atomically', async () => {
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
          timestamp: '',
          installment_number: 1,
        },
      ],
    })

    const txSelect = vi.fn().mockResolvedValue({ data: [{ id: 'internal-tx-uuid' }], error: null })
    const txUpsert = vi.fn().mockReturnValue({ select: txSelect })
    const rpc = vi.fn().mockResolvedValue({ error: null })

    const from = vi.fn((table: string) => {
      if (table === 'sumup_transactions') return { upsert: txUpsert }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from, rpc } as never)

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
    expect(rpc).toHaveBeenCalledWith('replace_sumup_transaction_events', {
      p_transaction_id: 'internal-tx-uuid',
      p_events: [
        expect.objectContaining({
          org_id: ORG_ID,
          sumup_event_id: 'ev1',
          event_type: 'PAYOUT',
          due_date: null,
          // "" from the API must not reach a timestamptz column.
          event_timestamp: null,
        }),
      ],
    })
    // The transaction_id parent comes from the RPC argument, never the payload.
    expect(rpc.mock.calls[0][1].p_events[0]).not.toHaveProperty('transaction_id')
  })

  it('normalizes an empty timestamp on the transaction itself to null', async () => {
    vi.mocked(paginateSumupTransactions).mockReturnValue(
      fakePages([[{ transaction_code: 'TX-EMPTY' }]]) as never
    )
    vi.mocked(sumupFetch).mockResolvedValue({
      transaction_code: 'TX-EMPTY',
      amount: 10,
      currency: 'BRL',
      timestamp: '',
      status: 'SUCCESSFUL',
      transaction_events: [],
    })

    const txSelect = vi.fn().mockResolvedValue({ data: [{ id: 'internal-tx-empty' }], error: null })
    const txUpsert = vi.fn().mockReturnValue({ select: txSelect })
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn(() => ({ upsert: txUpsert }))
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from, rpc } as never)

    const { syncSumupTransactions } = await import('@/lib/sumup/sync/transactions')
    await syncSumupTransactions(ORG_ID)

    expect(txUpsert.mock.calls[0][0]).toMatchObject({ timestamp_utc: null })
  })

  it('still calls the replace RPC when a transaction has no events, so stale ones are cleared', async () => {
    vi.mocked(paginateSumupTransactions).mockReturnValue(
      fakePages([[{ transaction_code: 'TX3' }]]) as never
    )
    vi.mocked(sumupFetch).mockResolvedValue({
      transaction_code: 'TX3',
      amount: 5,
      currency: 'BRL',
      timestamp: '2026-06-01T00:00:00Z',
      status: 'SUCCESSFUL',
      transaction_events: [],
    })

    const txSelect = vi.fn().mockResolvedValue({ data: [{ id: 'internal-tx-3' }], error: null })
    const txUpsert = vi.fn().mockReturnValue({ select: txSelect })
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn(() => ({ upsert: txUpsert }))
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from, rpc } as never)

    const { syncSumupTransactions } = await import('@/lib/sumup/sync/transactions')
    await syncSumupTransactions(ORG_ID)

    expect(rpc).toHaveBeenCalledWith('replace_sumup_transaction_events', {
      p_transaction_id: 'internal-tx-3',
      p_events: [],
    })
  })

  it('throws when the replace RPC fails, reporting how many rows landed first', async () => {
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
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'replace boom' } })
    const from = vi.fn(() => ({ upsert: txUpsert }))
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from, rpc } as never)

    const { syncSumupTransactions } = await import('@/lib/sumup/sync/transactions')
    const { SumupSyncLegError } = await import('@/lib/sumup/sync/errors')

    const error = await syncSumupTransactions(ORG_ID).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(SumupSyncLegError)
    expect((error as Error).message).toMatch(/replace boom/)
    expect((error as InstanceType<typeof SumupSyncLegError>).received).toBe(0)
  })

  it('reports the number of transactions persisted before a mid-run failure', async () => {
    vi.mocked(paginateSumupTransactions).mockReturnValue(
      fakePages([[{ transaction_code: 'TX-OK' }, { transaction_code: 'TX-BAD' }]]) as never
    )
    vi.mocked(sumupFetch).mockImplementation(async (_path, query) => {
      const code = (query as { transaction_code: string }).transaction_code
      if (code === 'TX-BAD') throw new Error('detail boom')
      return {
        transaction_code: code,
        amount: 1,
        currency: 'BRL',
        timestamp: '2026-06-01T00:00:00Z',
        status: 'SUCCESSFUL',
        transaction_events: [],
      } as never
    })

    const txSelect = vi.fn().mockResolvedValue({ data: [{ id: 'internal-tx-ok' }], error: null })
    const txUpsert = vi.fn().mockReturnValue({ select: txSelect })
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn(() => ({ upsert: txUpsert }))
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from, rpc } as never)

    const { syncSumupTransactions } = await import('@/lib/sumup/sync/transactions')
    const { SumupSyncLegError } = await import('@/lib/sumup/sync/errors')

    const error = await syncSumupTransactions(ORG_ID).catch((thrown) => thrown)
    expect(error).toBeInstanceOf(SumupSyncLegError)
    expect((error as InstanceType<typeof SumupSyncLegError>).received).toBe(1)
    expect((error as Error).message).toBe('detail boom')
  })

  it('passes a changes_since filter derived from `since` to the paginator', async () => {
    vi.mocked(paginateSumupTransactions).mockReturnValue(fakePages([[]]) as never)
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from: vi.fn(), rpc: vi.fn() } as never)

    const { syncSumupTransactions } = await import('@/lib/sumup/sync/transactions')
    const since = new Date('2026-06-01T00:00:00.000Z')
    await syncSumupTransactions(ORG_ID, { since })

    expect(paginateSumupTransactions).toHaveBeenCalledWith('MC-TEST', {
      changes_since: '2026-06-01T00:00:00.000Z',
    })
  })
})
