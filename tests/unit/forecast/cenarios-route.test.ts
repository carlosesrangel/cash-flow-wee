import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canCreateScenario: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({ createForecastScenario: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { createForecastScenario } from '@/lib/forecast/engine'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/forecast/cenarios', { method: 'POST', body: JSON.stringify(body) })
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

describe('POST /api/forecast/cenarios', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: 'Pessimista' }))

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canCreateScenario', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canCreateScenario).mockReturnValue(false)

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: 'Pessimista' }))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: '' }))

    expect(response.status).toBe(400)
  })

  it('returns 400 when createForecastScenario throws', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(createForecastScenario).mockRejectedValue(new Error('Scenario from another organization'))

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: 'Pessimista', duplicateFromScenarioId: '550e8400-e29b-41d4-a716-446655440099' }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Scenario from another organization')
  })

  it('creates the scenario, logs forecast_scenario_created when not duplicating, and returns it', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(createForecastScenario).mockResolvedValue({
      id: 's-2',
      name: 'Pessimista',
      createdAt: '2026-08-01T00:00:00Z',
    })
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: 'Pessimista' }))
    const body = await response.json()

    expect(body).toEqual({ ok: true, scenario: { id: 's-2', name: 'Pessimista', createdAt: '2026-08-01T00:00:00Z' } })
    expect(createForecastScenario).toHaveBeenCalledWith(ORG_ID, 'Pessimista', 'profile-1', undefined)
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'forecast_scenario_created' }))
  })

  it('logs forecast_scenario_duplicated when duplicateFromScenarioId is given', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(createForecastScenario).mockResolvedValue({
      id: 's-3',
      name: 'Conservador (cópia)',
      createdAt: '2026-08-01T00:00:00Z',
    })
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: 'Conservador (cópia)', duplicateFromScenarioId: '550e8400-e29b-41d4-a716-446655440001' }))
    await response.json()

    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'forecast_scenario_duplicated' }))
  })

  it('still returns ok when audit log insert fails', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(createForecastScenario).mockResolvedValue({
      id: 's-4',
      name: 'Otimista',
      createdAt: '2026-08-02T00:00:00Z',
    })
    const auditInsert = vi.fn().mockResolvedValue({ error: { message: 'Database error' } })
    const from = vi.fn((table: string) => {
      if (table === 'audit_logs') return { insert: auditInsert }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: 'Otimista' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, scenario: { id: 's-4', name: 'Otimista', createdAt: '2026-08-02T00:00:00Z' } })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to write audit_logs for forecast_scenario_created:',
      'Database error'
    )
  })
})
