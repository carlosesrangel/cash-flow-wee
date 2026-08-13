import { paginateSumupTransactions } from '@/lib/sumup/paginate'
import { sumupFetch, getSumupMerchantCode } from '@/lib/sumup/client'
import { emptyToNull } from '@/lib/integrations/date'
import { SumupSyncLegError } from '@/lib/sumup/sync/errors'
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

  try {
    for await (const page of paginateSumupTransactions<SumupTransactionListItem>(merchantCode, baseQuery)) {
      for (const listItem of page) {
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
              timestamp_utc: emptyToNull(detail.timestamp),
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

        // Delete + insert of the full event set happens inside one Postgres
        // function (see 0010_replace_sumup_transaction_events.sql) so a failure
        // between the two cannot leave the transaction with no events at all.
        const events = detail.transaction_events ?? []
        const { error: eventsError } = await admin.rpc('replace_sumup_transaction_events', {
          p_transaction_id: transactionId,
          p_events: events.map((event) => ({
            org_id: orgId,
            sumup_event_id: event.id ?? null,
            event_type: event.event_type,
            status: event.status,
            amount: event.amount ?? null,
            event_date: emptyToNull(event.date),
            due_date: emptyToNull(event.due_date),
            event_timestamp: emptyToNull(event.timestamp),
            installment_number: event.installment_number ?? null,
            raw: event,
            synced_at: new Date().toISOString(),
          })),
        })

        if (eventsError) {
          throw new Error(
            `Failed to replace sumup_transaction_events for transaction ${detail.transaction_code}: ${eventsError.message}`
          )
        }

        // Counted only after the transaction and its events are persisted, so
        // the number reported on a failure reflects rows actually written.
        received += 1
      }
    }
  } catch (error) {
    throw new SumupSyncLegError(error instanceof Error ? error.message : String(error), {
      received,
      cause: error,
    })
  }

  return { received }
}
