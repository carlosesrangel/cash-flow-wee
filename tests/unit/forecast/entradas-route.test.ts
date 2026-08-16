import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canEditForecast: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({ updateForecastEntry: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { updateForecastEntry } from '@/lib/forecast/engine'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '550e8400-e29b-41d4-a716-446655440001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }
const VALID_BODY = { versionId: '550e8400-e29b-41d4-a716-446655440002', ano: 2026, mes: 8, receita: 1500 }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/forecast/entradas', { method: 'POST', body: JSON.stringify(body) })
}

function mockAdmin() {
  const auditInsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') return { insert: auditInsert }
    throw new Error(`unexpected table ${table}`)
  })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { auditInsert }
}

describe('POST /api/forecast/entradas', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when the member lacks canEditForecast', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canEditForecast).mockReturnValue(false)

    const { POST } = await import('@/app/api/forecast/entradas/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)

    const { POST } = await import('@/app/api/forecast/entradas/route')
    const response = await POST(buildRequest({ ...VALID_BODY, mes: 13 }))

    expect(response.status).toBe(400)
  })

  it('returns 400 when updateForecastEntry rejects a non-current version', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)
    vi.mocked(updateForecastEntry).mockRejectedValue(new Error('Só é possível editar a versão mais recente do forecast'))

    const { POST } = await import('@/app/api/forecast/entradas/route')
    const response = await POST(buildRequest(VALID_BODY))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Só é possível editar a versão mais recente do forecast')
  })

  it('updates the entry, writes an audit log with cenario/comentario, and returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)
    vi.mocked(updateForecastEntry).mockResolvedValue(undefined)
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/entradas/route')
    const response = await POST(buildRequest({ ...VALID_BODY, cenario: 'Base', comentario: 'Ajuste de vendas' }))
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(updateForecastEntry).toHaveBeenCalledWith(ORG_ID, VALID_BODY.versionId, 2026, 8, 1500, 'profile-1')
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'forecast_entry_updated',
        after: { receita: 1500, cenario: 'Base', comentario: 'Ajuste de vendas' },
      })
    )
  })

  it('still returns ok when audit log insert fails', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)
    vi.mocked(updateForecastEntry).mockResolvedValue(undefined)
    const auditInsert = vi.fn().mockResolvedValue({ error: { message: 'Database error' } })
    const from = vi.fn((table: string) => {
      if (table === 'audit_logs') return { insert: auditInsert }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/forecast/entradas/route')
    const response = await POST(buildRequest(VALID_BODY))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to write audit_logs for forecast_entry_updated:',
      'Database error'
    )
  })
})
