import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageIntegrations: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock('@/lib/ledger/populate', () => ({ syncLedgerFromAllSources: vi.fn() }))
vi.mock('@/lib/deduplication/rules', () => ({ auditLedgerForDuplicates: vi.fn() }))
vi.mock('@/lib/forecast/transform', () => ({
  transformForecastToReceipts: vi.fn(),
  validateForecastTransformInvariant: vi.fn(),
}))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { syncLedgerFromAllSources } from '@/lib/ledger/populate'
import { transformForecastToReceipts, validateForecastTransformInvariant } from '@/lib/forecast/transform'
import { GET as getFees } from '@/app/api/analytics/fees/route'
import { GET as getSeasonality } from '@/app/api/analytics/seasonality/route'
import { GET as getCashFlowSummary } from '@/app/api/cash-flow/summary/route'
import { POST as postProjectedReceipts } from '@/app/api/forecast/projected-receipts/route'
import { GET as getLedgerAudit } from '@/app/api/ledger/audit-duplicates/route'
import { GET as getLedgerBalance } from '@/app/api/ledger/balance/route'
import { POST as postLedgerSync } from '@/app/api/ledger/sync/route'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const OTHER_ORG_ID = '00000000-0000-0000-0000-000000000002'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'OWNER_ADMIN' as const }

function request(url: string, init?: RequestInit) {
  return new NextRequest(`http://localhost${url}`, init as never)
}

function thenableQuery(result: unknown) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.order = vi.fn(() => query)
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return query
}

describe('tenant boundaries for previously unprotected routes', () => {
  afterEach(() => vi.clearAllMocks())

  it('rejects every affected route without an authenticated member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const responses = await Promise.all([
      getFees(request('/api/analytics/fees')),
      getSeasonality(request('/api/analytics/seasonality')),
      getCashFlowSummary(request('/api/cash-flow/summary')),
      postProjectedReceipts(request('/api/forecast/projected-receipts', { method: 'POST', body: '{}' })),
      getLedgerAudit(request('/api/ledger/audit-duplicates')),
      getLedgerBalance(request('/api/ledger/balance')),
      postLedgerSync(request('/api/ledger/sync', { method: 'POST' })),
    ])

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401])
    expect(createAdminSupabaseClient).not.toHaveBeenCalled()
  })

  it('rejects a client-supplied organization that differs from the session tenant', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER)
    vi.mocked(canManageIntegrations).mockReturnValue(true)

    const responses = await Promise.all([
      getFees(request(`/api/analytics/fees?org_id=${OTHER_ORG_ID}`)),
      getSeasonality(request(`/api/analytics/seasonality?org_id=${OTHER_ORG_ID}`)),
      getCashFlowSummary(request(`/api/cash-flow/summary?org_id=${OTHER_ORG_ID}`)),
      postProjectedReceipts(request('/api/forecast/projected-receipts', {
        method: 'POST',
        body: JSON.stringify({ org_id: OTHER_ORG_ID, version_id: 'version-1' }),
      })),
      getLedgerAudit(request(`/api/ledger/audit-duplicates?org_id=${OTHER_ORG_ID}`)),
      getLedgerBalance(request(`/api/ledger/balance?org_id=${OTHER_ORG_ID}`)),
      postLedgerSync(request(`/api/ledger/sync?org_id=${OTHER_ORG_ID}`, { method: 'POST' })),
    ])

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403, 403])
    expect(createAdminSupabaseClient).not.toHaveBeenCalled()
    expect(syncLedgerFromAllSources).not.toHaveBeenCalled()
  })

  it('uses the session tenant when org_id is omitted', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER)
    vi.mocked(canManageIntegrations).mockReturnValue(true)
    vi.mocked(syncLedgerFromAllSources).mockResolvedValue({ success: true, org_id: ORG_ID, total_processed: 1, total_inserted: 1, total_skipped: 0, errors: [] })
    vi.mocked(transformForecastToReceipts).mockResolvedValue([])
    vi.mocked(validateForecastTransformInvariant).mockReturnValue(true)

    const versionQuery = thenableQuery({ data: { id: 'version-1' }, error: null })
    const entriesQuery = thenableQuery({ data: [], error: null })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({
      from: vi.fn((table: string) => table === 'forecast_versions' ? versionQuery : entriesQuery),
    } as never)

    const projectedResponse = await postProjectedReceipts(request('/api/forecast/projected-receipts', {
      method: 'POST',
      body: JSON.stringify({ version_id: 'version-1' }),
    }))
    const syncResponse = await postLedgerSync(request('/api/ledger/sync', { method: 'POST' }))

    expect(projectedResponse.status).toBe(200)
    expect(transformForecastToReceipts).toHaveBeenCalledWith(expect.anything(), ORG_ID, [])
    expect(syncResponse.status).toBe(200)
    expect(syncLedgerFromAllSources).toHaveBeenCalledWith(ORG_ID)
  })
})
