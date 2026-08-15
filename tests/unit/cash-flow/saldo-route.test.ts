import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageCashBalance: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'OWNER_ADMIN' as const }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/caixa/saldo', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function mockAdmin() {
  const snapshotInsertSelect = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: { id: 'snap-1' }, error: null }),
  })
  const snapshotInsert = vi.fn().mockReturnValue({ select: snapshotInsertSelect })
  const auditInsert = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    if (table === 'cash_balance_snapshots') return { insert: snapshotInsert }
    if (table === 'audit_logs') return { insert: auditInsert }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { snapshotInsert, auditInsert }
}

describe('POST /api/caixa/saldo', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/caixa/saldo/route')
    const response = await POST(buildRequest({ referenceDate: '2026-08-15', bankBalance: 1000 }))

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canManageCashBalance', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'MANAGER' } as never)
    vi.mocked(canManageCashBalance).mockReturnValue(false)

    const { POST } = await import('@/app/api/caixa/saldo/route')
    const response = await POST(buildRequest({ referenceDate: '2026-08-15', bankBalance: 1000 }))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageCashBalance).mockReturnValue(true)

    const { POST } = await import('@/app/api/caixa/saldo/route')
    const response = await POST(buildRequest({ referenceDate: 'not-a-date', bankBalance: 1000 }))

    expect(response.status).toBe(400)
  })

  it('inserts a snapshot, an audit log entry, and returns ok on a valid request', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageCashBalance).mockReturnValue(true)
    const { snapshotInsert, auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/caixa/saldo/route')
    const response = await POST(buildRequest({ referenceDate: '2026-08-15', bankBalance: 12000, notes: 'Extrato do dia' }))
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(snapshotInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        reference_date: '2026-08-15',
        bank_balance: 12000,
        notes: 'Extrato do dia',
        created_by: 'profile-1',
      })
    )
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        actor_profile_id: 'profile-1',
        action: 'cash_balance_snapshot_created',
        entity: 'cash_balance_snapshots',
      })
    )
  })
})
