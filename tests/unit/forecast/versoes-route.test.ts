import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canEditForecast: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({ createForecastVersion: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { createForecastVersion } from '@/lib/forecast/engine'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/forecast/versoes', { method: 'POST', body: JSON.stringify(body) })
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

describe('POST /api/forecast/versoes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/forecast/versoes/route')
    const response = await POST(buildRequest({ name: 'Forecast Agosto 2026' }))

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canEditForecast', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canEditForecast).mockReturnValue(false)

    const { POST } = await import('@/app/api/forecast/versoes/route')
    const response = await POST(buildRequest({ name: 'Forecast Agosto 2026' }))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)

    const { POST } = await import('@/app/api/forecast/versoes/route')
    const response = await POST(buildRequest({ name: '' }))

    expect(response.status).toBe(400)
  })

  it('creates the version, writes an audit log, and returns it on a valid request', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)
    vi.mocked(createForecastVersion).mockResolvedValue({
      id: 'v-2',
      name: 'Forecast Agosto 2026',
      createdAt: '2026-08-01T00:00:00Z',
    })
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/versoes/route')
    const response = await POST(buildRequest({ name: 'Forecast Agosto 2026' }))
    const body = await response.json()

    expect(body).toEqual({ ok: true, version: { id: 'v-2', name: 'Forecast Agosto 2026', createdAt: '2026-08-01T00:00:00Z' } })
    expect(createForecastVersion).toHaveBeenCalledWith(ORG_ID, 'Forecast Agosto 2026', 'profile-1')
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, actor_profile_id: 'profile-1', action: 'forecast_version_created' })
    )
  })

  it('still returns ok when audit log insert fails', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)
    vi.mocked(createForecastVersion).mockResolvedValue({
      id: 'v-3',
      name: 'Forecast Setembro 2026',
      createdAt: '2026-08-02T00:00:00Z',
    })
    const auditInsert = vi.fn().mockResolvedValue({ error: { message: 'Database error' } })
    const from = vi.fn((table: string) => {
      if (table === 'audit_logs') return { insert: auditInsert }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/forecast/versoes/route')
    const response = await POST(buildRequest({ name: 'Forecast Setembro 2026' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, version: { id: 'v-3', name: 'Forecast Setembro 2026', createdAt: '2026-08-02T00:00:00Z' } })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to write audit_logs for forecast_version_created:',
      'Database error'
    )
  })
})
