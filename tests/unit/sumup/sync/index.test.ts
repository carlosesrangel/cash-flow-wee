import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/sumup/sync/transactions', () => ({ syncSumupTransactions: vi.fn().mockResolvedValue({ received: 3 }) }))
vi.mock('@/lib/sumup/sync/payouts', () => ({ syncSumupPayouts: vi.fn().mockResolvedValue({ received: 2 }) }))
vi.mock('@/lib/olist/sync/run-context', () => ({
  startSyncRun: vi.fn().mockResolvedValue('run-1'),
  finishSyncRun: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/reconciliation', () => ({ runReconciliation: vi.fn().mockResolvedValue({ processed: 0 }) }))

import { syncSumupTransactions } from '@/lib/sumup/sync/transactions'
import { syncSumupPayouts } from '@/lib/sumup/sync/payouts'
import { startSyncRun, finishSyncRun } from '@/lib/olist/sync/run-context'
import { runReconciliation } from '@/lib/reconciliation'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('runSumupSync', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // `restoreAllMocks` only restores spies created with `vi.spyOn`; the plain
    // `vi.fn()` mocks declared in the `vi.mock` factories above keep accumulating
    // calls across tests within this file unless explicitly cleared too.
    vi.clearAllMocks()
  })

  it('logs a sync_runs entry for the sumup integration and sums received counts', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await runSumupSync(ORG_ID, 'initial')

    expect(startSyncRun).toHaveBeenCalledWith(ORG_ID, 'sumup')
    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'success', recordsReceived: 5, recordsCreated: null, recordsUpdated: null })
    )
  })

  it('does not pass a since date to transactions on initial mode', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await runSumupSync(ORG_ID, 'initial')

    expect(syncSumupTransactions).toHaveBeenCalledWith(ORG_ID, {})
  })

  it('passes a since date derived from 24h ago on incremental mode', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await runSumupSync(ORG_ID, 'incremental')

    expect(syncSumupTransactions).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ since: expect.any(Date) }))
  })

  it('uses a large windowDays for payouts on initial mode, default on incremental', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')

    await runSumupSync(ORG_ID, 'initial')
    expect(syncSumupPayouts).toHaveBeenLastCalledWith(ORG_ID, { windowDays: 3650 })

    await runSumupSync(ORG_ID, 'incremental')
    expect(syncSumupPayouts).toHaveBeenLastCalledWith(ORG_ID, {})
  })

  it('marks the run failed and rethrows when a sync function throws', async () => {
    vi.mocked(syncSumupPayouts).mockRejectedValueOnce(new Error('boom'))

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('boom')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('boom') })
    )
  })

  it('runs payouts before transactions', async () => {
    const order: string[] = []
    vi.mocked(syncSumupPayouts).mockImplementationOnce(async () => {
      order.push('payouts')
      return { received: 2 }
    })
    vi.mocked(syncSumupTransactions).mockImplementationOnce(async () => {
      order.push('transactions')
      return { received: 3 }
    })

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await runSumupSync(ORG_ID, 'initial')

    expect(order).toEqual(['payouts', 'transactions'])
  })

  it('still runs transactions when payouts fails, and payouts when transactions fails', async () => {
    vi.mocked(syncSumupPayouts).mockRejectedValueOnce(new Error('payouts boom'))

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('payouts boom')
    expect(syncSumupTransactions).toHaveBeenCalled()

    const payoutsCallsSoFar = vi.mocked(syncSumupPayouts).mock.calls.length
    vi.mocked(syncSumupTransactions).mockRejectedValueOnce(new Error('transactions boom'))
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('transactions boom')
    expect(vi.mocked(syncSumupPayouts).mock.calls.length).toBe(payoutsCallsSoFar + 1)
  })

  it('records what the succeeding leg received even when the other leg fails', async () => {
    vi.mocked(syncSumupTransactions).mockRejectedValueOnce(new Error('transactions boom'))

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('transactions boom')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', recordsReceived: 2, errorCount: 1 })
    )
  })

  it('records the partial progress a failing leg made before it failed', async () => {
    const { SumupSyncLegError } = await import('@/lib/sumup/sync/errors')
    vi.mocked(syncSumupTransactions).mockRejectedValueOnce(
      new SumupSyncLegError('detail boom', { received: 7 })
    )

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('detail boom')

    // 2 from payouts + the 7 rows the transactions leg had already persisted.
    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', recordsReceived: 9 })
    )
  })

  it('reports both failures when both legs fail', async () => {
    vi.mocked(syncSumupPayouts).mockRejectedValueOnce(new Error('payouts boom'))
    vi.mocked(syncSumupTransactions).mockRejectedValueOnce(new Error('transactions boom'))

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow(/payouts boom; transactions boom/)

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        errorCount: 2,
        errorMessage: 'payouts boom; transactions boom',
      })
    )
  })

  it('runs reconciliation after both legs succeed, before marking sync_runs success', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await runSumupSync(ORG_ID, 'initial')

    expect(runReconciliation).toHaveBeenCalledWith(ORG_ID)
  })

  it('does not run reconciliation when a leg fails', async () => {
    vi.mocked(syncSumupPayouts).mockRejectedValueOnce(new Error('boom'))

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('boom')

    expect(runReconciliation).not.toHaveBeenCalled()
  })

  it('marks the run failed and rethrows when reconciliation throws', async () => {
    vi.mocked(runReconciliation).mockRejectedValueOnce(new Error('reconciliation boom'))

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('reconciliation boom')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('reconciliation boom') })
    )
  })
})
