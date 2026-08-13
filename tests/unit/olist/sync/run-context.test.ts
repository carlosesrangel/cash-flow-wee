import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('startSyncRun / finishSyncRun', () => {
  afterEach(() => vi.restoreAllMocks())

  it('inserts a running row and returns its id', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const from = vi.fn().mockReturnValue({ insert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { startSyncRun } = await import('@/lib/olist/sync/run-context')
    const runId = await startSyncRun(ORG_ID, 'olist')

    expect(runId).toBe('run-1')
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, integration: 'olist', status: 'running' })
    )
  })

  it('updates the row with final counts on finish', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { finishSyncRun } = await import('@/lib/olist/sync/run-context')
    await finishSyncRun('run-1', {
      status: 'success',
      recordsReceived: 10,
      recordsCreated: 8,
      recordsUpdated: 2,
      errorCount: 0,
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        records_received: 10,
        records_created: 8,
        records_updated: 2,
        error_count: 0,
      })
    )
    expect(eq).toHaveBeenCalledWith('id', 'run-1')
  })
})
