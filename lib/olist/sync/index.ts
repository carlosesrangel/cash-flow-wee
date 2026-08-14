import { startSyncRun, finishSyncRun } from '@/lib/olist/sync/run-context'
import { syncSellers } from '@/lib/olist/sync/sellers'
import { syncPaymentMethods } from '@/lib/olist/sync/payment-methods'
import { syncContacts } from '@/lib/olist/sync/contacts'
import { syncProducts } from '@/lib/olist/sync/products'
import { syncOrders } from '@/lib/olist/sync/orders'
import { syncAccountsPayable } from '@/lib/olist/sync/accounts-payable'
import { syncAccountsReceivable } from '@/lib/olist/sync/accounts-receivable'
import { runReconciliation } from '@/lib/reconciliation'

export async function runOlistSync(orgId: string, mode: 'initial' | 'incremental'): Promise<void> {
  const runId = await startSyncRun(orgId, 'olist')

  const since = mode === 'incremental' ? new Date(Date.now() - 24 * 60 * 60 * 1000) : undefined
  const sinceOptions = since ? { since } : {}

  let received = 0

  try {
    // Reference data first — orders/AP/AR store references to these by olist_id.
    const sellers = await syncSellers(orgId)
    const paymentMethods = await syncPaymentMethods(orgId)
    const contacts = await syncContacts(orgId, sinceOptions)
    const products = await syncProducts(orgId)
    const orders = await syncOrders(orgId, sinceOptions)
    // On an initial sync, use a full-history window so a freshly connected account
    // imports all open/closed AP/AR, not just the last 90 days by due date. Aged-out
    // accounts (>90 days overdue, still open) may still not get status refreshes on
    // later incremental syncs — see docs/assumptions.md, "Riscos conhecidos (Fase 2)".
    const apArOptions = mode === 'initial' ? { windowDays: 3650 } : {}
    const accountsPayable = await syncAccountsPayable(orgId, apArOptions)
    const accountsReceivable = await syncAccountsReceivable(orgId, apArOptions)

    for (const result of [sellers, paymentMethods, contacts, products, orders, accountsPayable, accountsReceivable]) {
      received += result.received
    }

    await runReconciliation(orgId)

    await finishSyncRun(runId, {
      status: 'success',
      recordsReceived: received,
      recordsCreated: null,
      recordsUpdated: null,
      errorCount: 0,
    })
  } catch (error) {
    await finishSyncRun(runId, {
      status: 'failed',
      recordsReceived: received,
      recordsCreated: null,
      recordsUpdated: null,
      errorCount: 1,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
