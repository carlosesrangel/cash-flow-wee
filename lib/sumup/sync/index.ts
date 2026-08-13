import { startSyncRun, finishSyncRun } from '@/lib/olist/sync/run-context'
import { syncSumupTransactions } from '@/lib/sumup/sync/transactions'
import { syncSumupPayouts } from '@/lib/sumup/sync/payouts'

export async function runSumupSync(orgId: string, mode: 'initial' | 'incremental'): Promise<void> {
  const runId = await startSyncRun(orgId, 'sumup')

  const since = mode === 'incremental' ? new Date(Date.now() - 24 * 60 * 60 * 1000) : undefined
  const transactionsOptions = since ? { since } : {}
  const payoutsOptions = mode === 'initial' ? { windowDays: 3650 } : {}

  let received = 0

  try {
    const transactions = await syncSumupTransactions(orgId, transactionsOptions)
    const payouts = await syncSumupPayouts(orgId, payoutsOptions)

    received = transactions.received + payouts.received

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
