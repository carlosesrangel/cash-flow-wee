import { paginateSumupTransactions } from '@/lib/sumup/paginate'
import { sumupFetch, getSumupMerchantCode } from '@/lib/sumup/client'
import { emptyToNull } from '@/lib/integrations/date'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type SumupTransactionListItem = { transaction_code: string }

type SumupTransactionEvent = {
  id?: string | null
  event_type: string
  status: string
  amount?: number | null
  date?: string | null
  due_date?: string | null
  timestamp?: string | null
  installment_number?: number | null
}

type SumupTransactionDetail = {
  transaction_code: string
  transaction_id?: string | null
  amount: number
  currency: string
  timestamp: string
  status: string
  simple_status?: string | null
  payment_type?: string | null
  card_type?: string | null
  entry_mode?: string | null
  installments_count?: number | null
  auth_code?: string | null
  vat_amount?: number | null
  tip_amount?: number | null
  fee_amount?: number | null
  payouts_total?: number | null
  payouts_received?: number | null
  payout_plan?: string | null
  payout_date?: string | null
  payout_type?: string | null
  refunded_amount?: number | null
  product_summary?: string | null
  user?: string | null
  transaction_events?: SumupTransactionEvent[] | null
}

export async function syncSumupTransactions(
  orgId: string,
  options: { since?: Date } = {}
): Promise<{ received: number }> {
  const admin = createAdminSupabaseClient()
  const merchantCode = getSumupMerchantCode()
  let received = 0

  const baseQuery = options.since ? { changes_since: options.since.toISOString() } : {}

  for await (const page of paginateSumupTransactions<SumupTransactionListItem>(merchantCode, baseQuery)) {
    for (const listItem of page) {
      received += 1

      const detail = await sumupFetch<SumupTransactionDetail>(
        `/v2.1/merchants/${merchantCode}/transactions`,
        { transaction_code: listItem.transaction_code }
      )

      const { data: upserted, error: txError } = await admin
        .from('sumup_transactions')
        .upsert(
          {
            org_id: orgId,
            transaction_code: detail.transaction_code,
            transaction_id: detail.transaction_id ?? null,
            amount: detail.amount,
            currency: detail.currency,
            timestamp_utc: detail.timestamp,
            status: detail.status,
            simple_status: detail.simple_status ?? null,
            payment_type: detail.payment_type ?? null,
            card_type: detail.card_type ?? null,
            entry_mode: detail.entry_mode ?? null,
            installments_count: detail.installments_count ?? null,
            auth_code: detail.auth_code ?? null,
            vat_amount: detail.vat_amount ?? null,
            tip_amount: detail.tip_amount ?? null,
            fee_amount: detail.fee_amount ?? null,
            payouts_total: detail.payouts_total ?? null,
            payouts_received: detail.payouts_received ?? null,
            payout_plan: detail.payout_plan ?? null,
            payout_date: emptyToNull(detail.payout_date),
            payout_type: detail.payout_type ?? null,
            refunded_amount: detail.refunded_amount ?? null,
            product_summary: detail.product_summary ?? null,
            username: detail.user ?? null,
            raw: detail,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,transaction_code' }
        )
        .select('id')

      if (txError || !upserted?.[0]) {
        throw new Error(
          `Failed to upsert sumup_transactions ${detail.transaction_code}: ${txError?.message ?? 'no row returned'}`
        )
      }

      const transactionId = upserted[0].id as string

      const { error: deleteError } = await admin
        .from('sumup_transaction_events')
        .delete()
        .eq('transaction_id', transactionId)

      if (deleteError) {
        throw new Error(
          `Failed to delete sumup_transaction_events for transaction ${detail.transaction_code}: ${deleteError.message}`
        )
      }

      const events = detail.transaction_events ?? []
      if (events.length > 0) {
        const { error: eventsError } = await admin.from('sumup_transaction_events').insert(
          events.map((event) => ({
            org_id: orgId,
            transaction_id: transactionId,
            sumup_event_id: event.id ?? null,
            event_type: event.event_type,
            status: event.status,
            amount: event.amount ?? null,
            event_date: emptyToNull(event.date),
            due_date: emptyToNull(event.due_date),
            event_timestamp: event.timestamp ?? null,
            installment_number: event.installment_number ?? null,
            raw: event,
            synced_at: new Date().toISOString(),
          }))
        )

        if (eventsError) {
          throw new Error(
            `Failed to insert sumup_transaction_events for transaction ${detail.transaction_code}: ${eventsError.message}`
          )
        }
      }
    }
  }

  return { received }
}
