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
  return new Request('http://localhost/api/caixa/ajustes', { method: 'POST', body: JSON.stringify(body) })
}

function mockAdmin() {
  const insertSelect = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: { id: 'entry-1' }, error: null }),
  })
  const insert = vi.fn().mockReturnValue({ select: insertSelect })
  const auditInsert = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    if (table === 'manual_cash_entries') return { insert }
    if (table === 'audit_logs') return { insert: auditInsert }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { insert, auditInsert }
}

const VALID_BODY = {
  type: 'entrada',
  description: 'Aporte dos sócios',
  amount: 5000,
  entryDate: '2026-08-15',
  justification: 'Reforço de caixa combinado em reunião',
}

describe('POST /api/caixa/ajustes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/caixa/ajustes/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canManageCashBalance', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'MANAGER' } as never)
    vi.mocked(canManageCashBalance).mockReturnValue(false)

    const { POST } = await import('@/app/api/caixa/ajustes/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(403)
  })

  it('returns 400 when amount is not positive for an entrada', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageCashBalance).mockReturnValue(true)

    const { POST } = await import('@/app/api/caixa/ajustes/route')
    const response = await POST(buildRequest({ ...VALID_BODY, amount: 0 }))

    expect(response.status).toBe(400)
  })

  it('inserts a manual entry attributed to the caller, an audit log entry, and returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageCashBalance).mockReturnValue(true)
    const { insert, auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/caixa/ajustes/route')
    const response = await POST(buildRequest(VALID_BODY))
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        type: 'entrada',
        description: 'Aporte dos sócios',
        amount: 5000,
        entry_date: '2026-08-15',
        responsible_profile_id: 'profile-1',
        justification: 'Reforço de caixa combinado em reunião',
        created_by: 'profile-1',
      })
    )
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        actor_profile_id: 'profile-1',
        action: 'manual_cash_entry_created',
        entity: 'manual_cash_entries',
      })
    )
  })
})
