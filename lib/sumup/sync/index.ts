import { startSyncRun, finishSyncRun } from '@/lib/olist/sync/run-context'
import { syncSumupTransactions } from '@/lib/sumup/sync/transactions'
import { syncSumupPayouts } from '@/lib/sumup/sync/payouts'
import { receivedBeforeFailure } from '@/lib/sumup/sync/errors'
import { runReconciliation } from '@/lib/reconciliation'
import { refreshDerivedFinancialData } from '@/lib/sync/derived-refresh'

type LegOutcome = { received: number; error: Error | null }

/**
 * Runs one leg without letting its failure abort the other one. A leg that
 * fails still reports how far it got (see `SumupSyncLegError`), so the
 * `sync_runs` row records real partial progress instead of 0.
 */
async function runLeg(leg: () => Promise<{ received: number }>): Promise<LegOutcome> {
  try {
    const { received } = await leg()
    return { received, error: null }
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    return { received: receivedBeforeFailure(error), error: normalized }
  }
}

export async function runSumupSync(orgId: string, mode: 'initial' | 'incremental', options: { refreshDerived?: boolean } = {}): Promise<void> {
  const runId = await startSyncRun(orgId, 'sumup')

  // The 24h incremental window is only ever applied on a manual trigger (there
  // is no scheduler in this phase), so gaps wider than 24h between triggers can
  // miss changes — see docs/assumptions.md, "Riscos conhecidos (Fase 3)".
  const since = mode === 'incremental' ? new Date(Date.now() - 24 * 60 * 60 * 1000) : undefined
  const transactionsOptions = since ? { since } : {}
  const payoutsOptions = mode === 'initial' ? { windowDays: 3650 } : {}

  // Payouts first: it is a single cheap call, while transactions issues one
  // detail request per transaction and is the leg most likely to break on a bad
  // record deep in history. The two legs are isolated from each other so one
  // failing never means the other silently never ran.
  const payouts = await runLeg(() => syncSumupPayouts(orgId, payoutsOptions))
  const transactions = await runLeg(() => syncSumupTransactions(orgId, transactionsOptions))

  const received = payouts.received + transactions.received
  const errors = [payouts.error, transactions.error].filter((error): error is Error => error !== null)

  if (errors.length === 0) {
    try {
      await runReconciliation(orgId)
      if (options.refreshDerived !== false) await refreshDerivedFinancialData(orgId)
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

    await finishSyncRun(runId, {
      status: 'success',
      recordsReceived: received,
      recordsCreated: null,
      recordsUpdated: null,
      errorCount: 0,
    })
    return
  }

  // `finishSyncRun` only models a single status, so any failing leg makes the
  // whole run `failed` (which keeps the next trigger in `initial` mode) — but
  // `recordsReceived` still reports what both legs actually persisted.
  await finishSyncRun(runId, {
    status: 'failed',
    recordsReceived: received,
    recordsCreated: null,
    recordsUpdated: null,
    errorCount: errors.length,
    errorMessage: errors.map((error) => error.message).join('; '),
  })

  throw errors.length === 1 ? errors[0] : new Error(errors.map((error) => error.message).join('; '))
}
