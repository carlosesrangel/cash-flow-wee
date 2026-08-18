import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({
  loadAllVersions: vi.fn(),
  loadVersionEntries: vi.fn(),
  loadScenarios: vi.fn(),
  loadRealizadoByMonth: vi.fn(),
}))
vi.mock('@/lib/forecast/compare', () => ({ compareForecastToActual: vi.fn() }))
vi.mock('@/lib/forecast/scenarios', () => ({ applyScenario: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { loadAllVersions, loadVersionEntries, loadScenarios, loadRealizadoByMonth } from '@/lib/forecast/engine'
import { compareForecastToActual } from '@/lib/forecast/compare'
import { applyScenario } from '@/lib/forecast/scenarios'

const ORG_ID = '550e8400-e29b-41d4-a716-446655440001'
const VERSION_ID = '550e8400-e29b-41d4-a716-446655440002'
const SCENARIO_ID = '550e8400-e29b-41d4-a716-446655440003'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'VIEWER' as const }

const MOCK_ENTRIES = [
  { ano: 2026, mes: 8, value: 10000 },
  { ano: 2026, mes: 9, value: 12000 },
]

const MOCK_REALIZADO = [{ ano: 2026, mes: 8, value: 9500 }]

const MOCK_REPORT = [
  { ano: 2026, mes: 8, planejado: 10000, realizado: 9500, diferencaAbsoluta: -500, diferencaPercentual: -0.05 },
  { ano: 2026, mes: 9, planejado: 12000, realizado: null, diferencaAbsoluta: null, diferencaPercentual: null },
]

function createMockRequest(url: URL) {
  return {
    nextUrl: url,
  }
}

describe('GET /api/forecast/relatorio', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 401 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { GET } = await import('@/app/api/forecast/relatorio/route')
    const mockReq = createMockRequest(new URL('http://localhost/api/forecast/relatorio'))
    const response = await GET(mockReq as never)

    expect(response.status).toBe(401)
  })

  it('returns 400 on invalid versionId query param', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)

    const { GET } = await import('@/app/api/forecast/relatorio/route')
    const mockReq = createMockRequest(new URL('http://localhost/api/forecast/relatorio?versionId=invalid'))
    const response = await GET(mockReq as never)

    expect(response.status).toBe(400)
  })

  it('returns 404 when no versions exist and none specified', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(loadAllVersions).mockResolvedValue([])

    const { GET } = await import('@/app/api/forecast/relatorio/route')
    const mockReq = createMockRequest(new URL('http://localhost/api/forecast/relatorio'))
    const response = await GET(mockReq as never)

    expect(response.status).toBe(404)
  })

  it('returns 404 when specified version does not belong to org', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(loadAllVersions).mockResolvedValue([{ id: 'other-version-id', name: 'Other', createdAt: '2026-08-16' }])

    const { GET } = await import('@/app/api/forecast/relatorio/route')
    const mockReq = createMockRequest(new URL(`http://localhost/api/forecast/relatorio?versionId=${VERSION_ID}`))
    const response = await GET(mockReq as never)

    expect(response.status).toBe(404)
  })

  it('returns 404 when version has no entries', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(loadAllVersions).mockResolvedValue([{ id: VERSION_ID, name: 'Current', createdAt: '2026-08-16' }])
    vi.mocked(loadVersionEntries).mockResolvedValue([])

    const { GET } = await import('@/app/api/forecast/relatorio/route')
    const mockReq = createMockRequest(new URL(`http://localhost/api/forecast/relatorio?versionId=${VERSION_ID}`))
    const response = await GET(mockReq as never)

    expect(response.status).toBe(404)
  })

  it('returns 404 when specified scenario does not exist', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(loadAllVersions).mockResolvedValue([{ id: VERSION_ID, name: 'Current', createdAt: '2026-08-16' }])
    vi.mocked(loadVersionEntries).mockResolvedValue(MOCK_ENTRIES as never)
    vi.mocked(loadScenarios).mockResolvedValue([])

    const { GET } = await import('@/app/api/forecast/relatorio/route')
    const url = new URL('http://localhost/api/forecast/relatorio')
    url.searchParams.append('versionId', VERSION_ID)
    url.searchParams.append('scenarioId', SCENARIO_ID)
    const mockReq = createMockRequest(url)
    const response = await GET(mockReq as never)

    expect(response.status).toBe(404)
  })

  it('returns 200 with default entries when no scenario is specified', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(loadAllVersions).mockResolvedValue([{ id: VERSION_ID, name: 'Current', createdAt: '2026-08-16' }])
    vi.mocked(loadVersionEntries).mockResolvedValue(MOCK_ENTRIES as never)
    vi.mocked(loadRealizadoByMonth).mockResolvedValue(MOCK_REALIZADO as never)
    vi.mocked(compareForecastToActual).mockReturnValue(MOCK_REPORT as never)

    const { GET } = await import('@/app/api/forecast/relatorio/route')
    const mockReq = createMockRequest(new URL(`http://localhost/api/forecast/relatorio?versionId=${VERSION_ID}`))
    const response = await GET(mockReq as never)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { months: typeof MOCK_REPORT }
    expect(body.months).toEqual(MOCK_REPORT)
  })

  it('applies scenario when specified', async () => {
    const scenario = { scenario: { id: SCENARIO_ID, name: 'Conservador', createdAt: '2026-08-16' }, multipliers: [{ ano: 2026, mes: 8, value: 0.9 }] }
    const appliedEntries = [{ ano: 2026, mes: 8, value: 9000 }]

    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(loadAllVersions).mockResolvedValue([{ id: VERSION_ID, name: 'Current', createdAt: '2026-08-16' }])
    vi.mocked(loadVersionEntries).mockResolvedValue(MOCK_ENTRIES as never)
    vi.mocked(loadScenarios).mockResolvedValue([scenario] as never)
    vi.mocked(applyScenario).mockReturnValue(appliedEntries as never)
    vi.mocked(loadRealizadoByMonth).mockResolvedValue(MOCK_REALIZADO as never)
    vi.mocked(compareForecastToActual).mockReturnValue(MOCK_REPORT as never)

    const { GET } = await import('@/app/api/forecast/relatorio/route')
    const url = new URL('http://localhost/api/forecast/relatorio')
    url.searchParams.append('versionId', VERSION_ID)
    url.searchParams.append('scenarioId', SCENARIO_ID)
    const mockReq = createMockRequest(url)
    const response = await GET(mockReq as never)

    expect(response.status).toBe(200)
    expect(vi.mocked(applyScenario)).toHaveBeenCalledWith(MOCK_ENTRIES, scenario.multipliers)
  })
})
