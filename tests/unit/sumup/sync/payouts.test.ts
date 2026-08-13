import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/sumup/client', () => ({
  sumupFetch: vi.fn(),
  getSumupMerchantCode: vi.fn(() => 'MC-TEST'),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { sumupFetch } from '@/lib/sumup/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam } from '@/lib/integrations/date'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('syncSumupPayouts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps and upserts payouts from a bare array response', async () => {
    vi.mocked(sumupFetch).mockResolvedValue([
      {
        id: 123456789,
        type: 'PAYOUT',
        amount: 132.45,
        date: '2026-06-01',
        currency: 'BRL',
        fee: 3.12,
        status: 'SUCCESSFUL',
        reference: 'payout-ref',
        transaction_code: 'TX1',
      },
    ])

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncSumupPayouts } = await import('@/lib/sumup/sync/payouts')
    const result = await syncSumupPayouts(ORG_ID)

    expect(result).toEqual({ received: 1 })
    expect(from).toHaveBeenCalledWith('sumup_payouts')
    expect(upsert.mock.calls[0][0][0]).toMatchObject({
      org_id: ORG_ID,
      sumup_payout_id: 123456789,
      type: 'PAYOUT',
      status: 'SUCCESSFUL',
    })
  })

  it('queries with a 90-day default window (start_date/end_date)', async () => {
    vi.mocked(sumupFetch).mockResolvedValue([])

    const { syncSumupPayouts } = await import('@/lib/sumup/sync/payouts')
    await syncSumupPayouts(ORG_ID)

    const windowStart = new Date()
    windowStart.setDate(windowStart.getDate() - 90)

    expect(sumupFetch).toHaveBeenCalledWith(
      '/v2.1/merchants/MC-TEST/payouts'.replace('v2.1', 'v1.0'),
      expect.objectContaining({
        start_date: toLocalDateParam(windowStart),
        end_date: toLocalDateParam(new Date()),
      })
    )
  })

  it('accepts an overridable windowDays option', async () => {
    vi.mocked(sumupFetch).mockResolvedValue([])

    const { syncSumupPayouts } = await import('@/lib/sumup/sync/payouts')
    await syncSumupPayouts(ORG_ID, { windowDays: 30 })

    const windowStart = new Date()
    windowStart.setDate(windowStart.getDate() - 30)

    expect(sumupFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ start_date: toLocalDateParam(windowStart) })
    )
  })
})
