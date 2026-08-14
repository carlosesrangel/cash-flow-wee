import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/sync/sellers', () => ({ syncSellers: vi.fn().mockResolvedValue({ received: 1 }) }))
vi.mock('@/lib/olist/sync/payment-methods', () => ({ syncPaymentMethods: vi.fn().mockResolvedValue({ received: 1 }) }))
vi.mock('@/lib/olist/sync/contacts', () => ({ syncContacts: vi.fn().mockResolvedValue({ received: 2 }) }))
vi.mock('@/lib/olist/sync/products', () => ({ syncProducts: vi.fn().mockResolvedValue({ received: 3 }) }))
vi.mock('@/lib/olist/sync/orders', () => ({ syncOrders: vi.fn().mockResolvedValue({ received: 4 }) }))
vi.mock('@/lib/olist/sync/accounts-payable', () => ({ syncAccountsPayable: vi.fn().mockResolvedValue({ received: 5 }) }))
vi.mock('@/lib/olist/sync/accounts-receivable', () => ({ syncAccountsReceivable: vi.fn().mockResolvedValue({ received: 6 }) }))
vi.mock('@/lib/olist/sync/run-context', () => ({
  startSyncRun: vi.fn().mockResolvedValue('run-1'),
  finishSyncRun: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/reconciliation', () => ({ runReconciliation: vi.fn().mockResolvedValue({ processed: 0 }) }))

import { syncContacts } from '@/lib/olist/sync/contacts'
import { syncOrders } from '@/lib/olist/sync/orders'
import { syncAccountsPayable } from '@/lib/olist/sync/accounts-payable'
import { syncAccountsReceivable } from '@/lib/olist/sync/accounts-receivable'
import { startSyncRun, finishSyncRun } from '@/lib/olist/sync/run-context'
import { runReconciliation } from '@/lib/reconciliation'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('runOlistSync', () => {
  afterEach(() => vi.restoreAllMocks())

  it('runs reference data before orders/AP/AR, and logs one sync_runs entry', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'initial')

    expect(startSyncRun).toHaveBeenCalledWith(ORG_ID, 'olist')
    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'success' })
    )

    const contactsCallOrder = vi.mocked(syncContacts).mock.invocationCallOrder[0]
    const ordersCallOrder = vi.mocked(syncOrders).mock.invocationCallOrder[0]
    expect(contactsCallOrder).toBeLessThan(ordersCallOrder)
  })

  it('reports recordsCreated/recordsUpdated as null instead of a fabricated count', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'initial')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ recordsReceived: 1 + 1 + 2 + 3 + 4 + 5 + 6, recordsCreated: null, recordsUpdated: null })
    )
  })

  it('passes a large windowDays to AP/AR sync on an initial sync', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'initial')

    expect(syncAccountsPayable).toHaveBeenCalledWith(ORG_ID, { windowDays: 3650 })
    expect(syncAccountsReceivable).toHaveBeenCalledWith(ORG_ID, { windowDays: 3650 })
  })

  it('passes the default (90-day) window to AP/AR sync on an incremental sync', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'incremental')

    expect(syncAccountsPayable).toHaveBeenCalledWith(ORG_ID, {})
    expect(syncAccountsReceivable).toHaveBeenCalledWith(ORG_ID, {})
  })

  it('does not pass a since date on an initial sync', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'initial')

    expect(syncContacts).toHaveBeenCalledWith(ORG_ID, {})
  })

  it('passes a since date derived from the last successful run on an incremental sync', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'incremental')

    expect(syncContacts).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ since: expect.any(Date) }))
  })

  it('marks the run failed and rethrows when an entity sync throws', async () => {
    vi.mocked(syncOrders).mockRejectedValueOnce(new Error('boom'))

    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await expect(runOlistSync(ORG_ID, 'initial')).rejects.toThrow('boom')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('boom') })
    )
  })

  it('runs reconciliation after a successful sync, before marking sync_runs success', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'initial')

    expect(runReconciliation).toHaveBeenCalledWith(ORG_ID)
    const reconciliationCallOrder = vi.mocked(runReconciliation).mock.invocationCallOrder[0]
    const finishCallOrder = vi.mocked(finishSyncRun).mock.invocationCallOrder[0]
    expect(reconciliationCallOrder).toBeLessThan(finishCallOrder)
  })

  it('marks the run failed and rethrows when reconciliation throws', async () => {
    vi.mocked(runReconciliation).mockRejectedValueOnce(new Error('reconciliation boom'))

    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await expect(runOlistSync(ORG_ID, 'initial')).rejects.toThrow('reconciliation boom')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('reconciliation boom') })
    )
  })
})
