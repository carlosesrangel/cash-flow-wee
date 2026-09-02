import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({
  loadAllVersions: vi.fn(),
  loadVersionEntries: vi.fn(),
  loadScenarios: vi.fn(),
}))
vi.mock('@/lib/forecast/scenarios', () => ({ applyScenario: vi.fn() }))

import { loadForecastedCashFlowEntries, mergeCashFlowWithForecast } from '@/lib/forecast/projection'
import { loadAllVersions, loadVersionEntries, loadScenarios } from '@/lib/forecast/engine'
import { applyScenario } from '@/lib/forecast/scenarios'

const ORG_ID = '550e8400-e29b-41d4-a716-446655440001'
const VERSION_ID = '550e8400-e29b-41d4-a716-446655440002'

const MOCK_ENTRIES = [
  { ano: 2026, mes: 9, value: 10000 },
  { ano: 2026, mes: 10, value: 12000 },
]

const MOCK_ACTUAL_ENTRIES = [
  {
    id: 'ar-001',
    origin: 'ar' as const,
    sourceId: 'ar-001',
    date: '2026-08-15',
    amount: 5000,
    direction: 'entrada' as const,
    bucket: 'realizado' as const,
    description: 'Agosto',
  },
]

describe('loadForecastedCashFlowEntries', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns empty array when no versions exist', async () => {
    vi.mocked(loadAllVersions).mockResolvedValue([])

    const result = await loadForecastedCashFlowEntries(ORG_ID)

    expect(result).toEqual([])
  })

  it('returns empty array when version has no entries', async () => {
    vi.mocked(loadAllVersions).mockResolvedValue([{ id: VERSION_ID, name: 'Current', createdAt: '2026-08-16' }])
    vi.mocked(loadVersionEntries).mockResolvedValue([])

    const result = await loadForecastedCashFlowEntries(ORG_ID, VERSION_ID)

    expect(result).toEqual([])
  })

  it('converts forecast entries to cash flow format with origin forecast', async () => {
    vi.mocked(loadAllVersions).mockResolvedValue([{ id: VERSION_ID, name: 'Current', createdAt: '2026-08-16' }])
    vi.mocked(loadVersionEntries).mockResolvedValue(MOCK_ENTRIES as never)
    vi.mocked(applyScenario).mockReturnValue(MOCK_ENTRIES as never)

    const result = await loadForecastedCashFlowEntries(ORG_ID, VERSION_ID)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      origin: 'forecast',
      bucket: 'projetado',
      direction: 'entrada',
      amount: 12000,
      date: '2026-10-01',
    })
    expect(result[0]).toMatchObject({ amount: 12000, date: '2026-10-01' })
  })

  it('applies scenario when specified', async () => {
    const scenario = { scenario: { id: 'scenario-1', name: 'Conservador', createdAt: '2026-08-16' }, multipliers: [{ ano: 2026, mes: 9, value: 0.9 }] }
    vi.mocked(loadAllVersions).mockResolvedValue([{ id: VERSION_ID, name: 'Current', createdAt: '2026-08-16' }])
    vi.mocked(loadVersionEntries).mockResolvedValue(MOCK_ENTRIES as never)
    vi.mocked(loadScenarios).mockResolvedValue([scenario] as never)
    vi.mocked(applyScenario).mockReturnValue([{ ano: 2026, mes: 9, value: 9000 }] as never)

    const result = await loadForecastedCashFlowEntries(ORG_ID, VERSION_ID, 'scenario-1')

    expect(vi.mocked(applyScenario)).toHaveBeenCalledWith(MOCK_ENTRIES, scenario.multipliers)
    expect(result.length).toBe(0)
  })
})

describe('mergeCashFlowWithForecast', () => {
  it('includes only future forecast entries', () => {
    const forecastEntries = [
      { id: 'f-aug', origin: 'forecast' as const, sourceId: 'v1', date: '2026-08-01', amount: 1000, direction: 'entrada' as const, bucket: 'projetado' as const, description: 'Forecast' },
      { id: 'f-sep', origin: 'forecast' as const, sourceId: 'v1', date: '2026-09-01', amount: 2000, direction: 'entrada' as const, bucket: 'projetado' as const, description: 'Forecast' },
    ]
    const today = { ano: 2026, mes: 9 }

    const result = mergeCashFlowWithForecast(MOCK_ACTUAL_ENTRIES, forecastEntries, today)

    // Current competence is protected; only the next month is projected.
    const forecasts = result.filter((e) => e.origin === ('forecast' as any))
    expect(forecasts).toHaveLength(0)
  })

  it('returns only actual entries when no forecast', () => {
    const today = { ano: 2026, mes: 8 }

    const result = mergeCashFlowWithForecast(MOCK_ACTUAL_ENTRIES, [], today)

    expect(result).toEqual(MOCK_ACTUAL_ENTRIES)
  })
})
