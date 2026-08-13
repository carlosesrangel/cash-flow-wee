import { sumupFetch, getSumupMerchantCode } from '@/lib/sumup/client'
import { toLocalDateParam } from '@/lib/integrations/date'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type SumupPayout = {
  id: number
  type: string
  amount: number
  date: string
  currency: string
  fee?: number | null
  status: string
  reference?: string | null
  transaction_code?: string | null
}

export async function syncSumupPayouts(
  orgId: string,
  options: { windowDays?: number } = {}
): Promise<{ received: number }> {
  const admin = createAdminSupabaseClient()
  const merchantCode = getSumupMerchantCode()

  const windowDays = options.windowDays ?? 90
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - windowDays)

  // SumUp's payouts endpoint returns a bare JSON array with no pagination
  // metadata (no Link header, no total-count header, nothing). 9999 is the
  // documented maximum `limit`. If we ever get back exactly `limit` results,
  // we cannot tell whether that's the true count or a silent truncation, so
  // we fail loudly instead of reporting an incomplete sync as successful.
  const limit = 9999
  const payouts = await sumupFetch<SumupPayout[]>(`/v1.0/merchants/${merchantCode}/payouts`, {
    start_date: toLocalDateParam(windowStart),
    end_date: toLocalDateParam(new Date()),
    limit,
  })

  if (payouts.length === limit) {
    throw new Error(
      `Payout sync may be truncated: received exactly the requested limit (${limit}) of payouts for the ${windowDays}-day window — narrow the window or implement real pagination`
    )
  }

  if (payouts.length === 0) {
    return { received: 0 }
  }

  const rows = payouts.map((payout) => ({
    org_id: orgId,
    sumup_payout_id: payout.id,
    type: payout.type,
    amount: payout.amount,
    currency: payout.currency,
    payout_date: payout.date,
    fee: payout.fee ?? null,
    status: payout.status,
    reference: payout.reference ?? null,
    transaction_code: payout.transaction_code ?? null,
    raw: payout,
    synced_at: new Date().toISOString(),
  }))

  const { error } = await admin.from('sumup_payouts').upsert(rows, { onConflict: 'org_id,sumup_payout_id' })
  if (error) throw new Error(`Failed to upsert sumup_payouts: ${error.message}`)

  return { received: payouts.length }
}
