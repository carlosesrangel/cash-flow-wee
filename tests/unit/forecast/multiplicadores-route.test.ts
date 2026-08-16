import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canCreateScenario: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({ updateScenarioMultiplier: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { updateScenarioMultiplier } from '@/lib/forecast/engine'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }
const VALID_BODY = { scenarioId: '550e8400-e29b-41d4-a716-446655440002', ano: 2026, mes: 8, percentual: 90 }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/forecast/cenarios/multiplicadores', { method: 'POST', body: JSON.stringify(body) })
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

describe('POST /api/forecast/cenarios/multiplicadores', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when the member is null', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null as never)

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canCreateScenario', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canCreateScenario).mockReturnValue(false)

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest({ ...VALID_BODY, percentual: -5 }))

    expect(response.status).toBe(400)
  })

  it('returns 400 when updateScenarioMultiplier rejects a foreign scenario', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(updateScenarioMultiplier).mockRejectedValue(new Error('Cenário não encontrado'))

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(400)
  })

  it('returns 200 with ok:true when audit_logs insert fails, and calls console.error', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(updateScenarioMultiplier).mockResolvedValue(undefined)

    const auditInsert = vi.fn().mockResolvedValue({ error: { message: 'Database error' } })
    const from = vi.fn((table: string) => {
      if (table === 'audit_logs') return { insert: auditInsert }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest(VALID_BODY))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to write audit_logs for forecast_scenario_multiplier_updated:',
      'Database error'
    )

    consoleErrorSpy.mockRestore()
  })

  it('updates the multiplier, writes an audit log, and returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(updateScenarioMultiplier).mockResolvedValue(undefined)
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest(VALID_BODY))
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(updateScenarioMultiplier).toHaveBeenCalledWith(ORG_ID, VALID_BODY.scenarioId, 2026, 8, 90)
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'forecast_scenario_multiplier_updated' })
    )
  })
})
