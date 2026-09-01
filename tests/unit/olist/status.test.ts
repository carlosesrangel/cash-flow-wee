import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

function query(result: unknown) {
  const builder: Record<string, any> = {}
  for (const method of ['select', 'eq', 'neq', 'not', 'order', 'limit', 'range']) builder[method] = vi.fn().mockReturnValue(builder)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.single = vi.fn().mockResolvedValue(result)
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockDatabase(connection: unknown) {
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'integration_connections') return query({ data: connection, error: null })
    if (table === 'sync_runs') return query({ data: [], error: null })
    return query({ count: 0, data: null, error: null })
  })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return from
}

describe('getOlistConnectionStatus', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns desconectado when there is no connection row', async () => {
    mockDatabase(null)
    const { getOlistConnectionStatus } = await import('@/lib/olist/status')
    const result = await getOlistConnectionStatus(ORG_ID)

    expect(result).toMatchObject({ status: 'desconectado', connectedAt: null, lastSyncAt: null, lastSyncStatus: null })
    expect(result.payableCategories).toEqual({ categorized: 0, total: 0, coveragePct: 100 })
  })

  it('returns the stored status and connectedAt, never the tokens', async () => {
    const from = mockDatabase({ status: 'conectado', connected_at: '2026-08-12T00:00:00Z' })
    const { getOlistConnectionStatus } = await import('@/lib/olist/status')
    const result = await getOlistConnectionStatus(ORG_ID)

    expect(result).toMatchObject({ status: 'conectado', connectedAt: '2026-08-12T00:00:00Z', lastSyncAt: null, lastSyncStatus: null })
    expect(result.payableCategories).toEqual({ categorized: 0, total: 0, coveragePct: 100 })
    expect(from.mock.results[0]?.value.select).toHaveBeenCalledWith('status, connected_at')
  })
})
