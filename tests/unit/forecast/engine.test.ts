import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  loadAllVersions,
  loadVersionEntries,
  loadScenarios,
  loadRealizadoByMonth,
  createForecastVersion,
  updateForecastEntry,
  createForecastScenario,
  updateScenarioMultiplier,
} from '@/lib/forecast/engine'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const OTHER_ORG_ID = '00000000-0000-0000-0000-000000000099'

type Row = Record<string, unknown>

function makePageableChain(rows: Row[]) {
  let from = 0
  let to = 499
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.not = vi.fn(() => chain)
  chain.range = vi.fn((nextFrom: number, nextTo: number) => {
    from = nextFrom
    to = nextTo
    return chain
  })
  chain.then = (resolve: (value: { data: Row[]; error: null }) => unknown) =>
    resolve({ data: rows.slice(from, to + 1), error: null })
  return chain
}

function makeSingleChain(row: Row | null) {
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: row, error: null }))
  return chain
}

function mockAdmin(options: {
  versionRows?: Row[]
  entryRows?: Row[]
  scenarioRows?: Row[]
  multiplierRowsByScenario?: Record<string, Row[]>
  orderRows?: Row[]
  versionLookup?: Row | null
  scenarioLookup?: Row | null
  insertedVersion?: Row
  insertedScenario?: Row
}) {
  const versionRows = options.versionRows ?? []
  const entryRows = options.entryRows ?? []
  const scenarioRows = options.scenarioRows ?? []
  const multiplierRowsByScenario = options.multiplierRowsByScenario ?? {}
  const orderRows = options.orderRows ?? []

  const versionInsertSingle = vi.fn().mockResolvedValue({ data: options.insertedVersion ?? null, error: null })
  const versionInsertSelect = vi.fn(() => ({ single: versionInsertSingle }))
  const versionInsert = vi.fn(() => ({ select: versionInsertSelect }))

  const scenarioInsertSingle = vi.fn().mockResolvedValue({ data: options.insertedScenario ?? null, error: null })
  const scenarioInsertSelect = vi.fn(() => ({ single: scenarioInsertSingle }))
  const scenarioInsert = vi.fn(() => ({ select: scenarioInsertSelect }))

  const entryInsert = vi.fn().mockResolvedValue({ error: null })
  const entryUpsert = vi.fn().mockResolvedValue({ error: null })
  const multiplierInsert = vi.fn().mockResolvedValue({ error: null })
  const multiplierUpsert = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    if (table === 'forecast_versions') {
      return {
        select: vi.fn((columns: string) => {
          if (columns === 'id') return makeSingleChain(options.versionLookup ?? null)
          return makePageableChain(versionRows)
        }),
        insert: versionInsert,
      }
    }
    if (table === 'forecast_entries') {
      return { select: vi.fn(() => makePageableChain(entryRows)), insert: entryInsert, upsert: entryUpsert }
    }
    if (table === 'forecast_scenarios') {
      return {
        select: vi.fn((columns: string) => {
          if (columns === 'id') return makeSingleChain(options.scenarioLookup ?? null)
          return makePageableChain(scenarioRows)
        }),
        insert: scenarioInsert,
      }
    }
    if (table === 'forecast_scenario_multipliers') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, scenarioId: string) => makePageableChain(multiplierRowsByScenario[scenarioId] ?? [])),
        })),
        insert: multiplierInsert,
        upsert: multiplierUpsert,
      }
    }
    if (table === 'olist_orders') return { select: vi.fn(() => makePageableChain(orderRows)) }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { versionInsert, scenarioInsert, entryInsert, entryUpsert, multiplierInsert, multiplierUpsert }
}

describe('loadAllVersions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns versions ordered most-recent-first', async () => {
    mockAdmin({
      versionRows: [
        { id: 'v-2', name: 'Forecast Agosto 2026', created_at: '2026-08-01T00:00:00Z' },
        { id: 'v-1', name: 'Planejamento Original', created_at: '2026-06-01T00:00:00Z' },
      ],
    })

    const versions = await loadAllVersions(ORG_ID)

    expect(versions).toEqual([
      { id: 'v-2', name: 'Forecast Agosto 2026', createdAt: '2026-08-01T00:00:00Z' },
      { id: 'v-1', name: 'Planejamento Original', createdAt: '2026-06-01T00:00:00Z' },
    ])
  })
})

describe('loadVersionEntries', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns the entries of a version that belongs to the org', async () => {
    mockAdmin({
      versionLookup: { id: 'v-1' },
      entryRows: [{ ano: 2026, mes: 8, receita: 1000 }],
    })

    const entries = await loadVersionEntries(ORG_ID, 'v-1')

    expect(entries).toEqual([{ ano: 2026, mes: 8, value: 1000 }])
  })

  it('throws when the version does not belong to the org', async () => {
    mockAdmin({ versionLookup: null })

    await expect(loadVersionEntries(OTHER_ORG_ID, 'v-1')).rejects.toThrow('Versão não encontrada')
  })
})

describe('loadScenarios', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns each scenario with its own multipliers', async () => {
    mockAdmin({
      scenarioRows: [{ id: 's-1', name: 'Base', created_at: '2026-06-01T00:00:00Z' }],
      multiplierRowsByScenario: { 's-1': [{ ano: 2026, mes: 8, percentual: 100 }] },
    })

    const scenarios = await loadScenarios(ORG_ID)

    expect(scenarios).toEqual([
      {
        scenario: { id: 's-1', name: 'Base', createdAt: '2026-06-01T00:00:00Z' },
        multipliers: [{ ano: 2026, mes: 8, value: 100 }],
      },
    ])
  })
})

describe('loadRealizadoByMonth', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sums valor_total_pedido grouped by month of data', async () => {
    mockAdmin({
      orderRows: [
        { data: '2026-08-05', valor_total_pedido: 100 },
        { data: '2026-08-20', valor_total_pedido: 50 },
        { data: '2026-09-01', valor_total_pedido: 200 },
      ],
    })

    const sums = await loadRealizadoByMonth(ORG_ID)

    expect(sums).toEqual(
      expect.arrayContaining([
        { ano: 2026, mes: 8, value: 150 },
        { ano: 2026, mes: 9, value: 200 },
      ])
    )
  })

  it('treats a null valor_total_pedido as 0, never NaN', async () => {
    mockAdmin({ orderRows: [{ data: '2026-08-05', valor_total_pedido: null }] })

    const sums = await loadRealizadoByMonth(ORG_ID)

    expect(sums).toEqual([{ ano: 2026, mes: 8, value: 0 }])
  })
})

describe('createForecastVersion', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates the version and copies the current version entries into it', async () => {
    const { versionInsert, entryInsert } = mockAdmin({
      versionRows: [{ id: 'v-1', name: 'Planejamento Original', created_at: '2026-06-01T00:00:00Z' }],
      versionLookup: { id: 'v-1' },
      entryRows: [{ ano: 2026, mes: 8, receita: 1000 }],
      insertedVersion: { id: 'v-2', name: 'Forecast Agosto 2026', created_at: '2026-08-01T00:00:00Z' },
    })

    const version = await createForecastVersion(ORG_ID, 'Forecast Agosto 2026', 'profile-1')

    expect(version).toEqual({ id: 'v-2', name: 'Forecast Agosto 2026', createdAt: '2026-08-01T00:00:00Z' })
    expect(versionInsert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, name: 'Forecast Agosto 2026', created_by: 'profile-1' })
    )
    expect(entryInsert).toHaveBeenCalledWith([
      expect.objectContaining({ version_id: 'v-2', ano: 2026, mes: 8, receita: 1000, updated_by: 'profile-1' }),
    ])
  })

  it('creates a version with no entries to copy when there is no prior version', async () => {
    const { entryInsert } = mockAdmin({
      versionRows: [],
      insertedVersion: { id: 'v-1', name: 'Planejamento Original', created_at: '2026-06-01T00:00:00Z' },
    })

    await createForecastVersion(ORG_ID, 'Planejamento Original', 'profile-1')

    expect(entryInsert).not.toHaveBeenCalled()
  })
})

describe('updateForecastEntry', () => {
  afterEach(() => vi.restoreAllMocks())

  it('upserts the entry when versionId is the current version', async () => {
    const { entryUpsert } = mockAdmin({
      versionRows: [{ id: 'v-2', name: 'Atual', created_at: '2026-08-01T00:00:00Z' }],
    })

    await updateForecastEntry(ORG_ID, 'v-2', 2026, 8, 1500, 'profile-1')

    expect(entryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ version_id: 'v-2', ano: 2026, mes: 8, receita: 1500, updated_by: 'profile-1' }),
      { onConflict: 'version_id,ano,mes' }
    )
  })

  it('rejects an edit to a version that is no longer the current one', async () => {
    mockAdmin({
      versionRows: [{ id: 'v-2', name: 'Atual', created_at: '2026-08-01T00:00:00Z' }],
    })

    await expect(updateForecastEntry(ORG_ID, 'v-1', 2026, 8, 1500, 'profile-1')).rejects.toThrow(
      'Só é possível editar a versão mais recente do forecast'
    )
  })
})

describe('createForecastScenario', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates a scenario with no multipliers when duplicateFromScenarioId is not given', async () => {
    const { scenarioInsert, multiplierInsert } = mockAdmin({
      insertedScenario: { id: 's-2', name: 'Pessimista', created_at: '2026-08-01T00:00:00Z' },
    })

    const scenario = await createForecastScenario(ORG_ID, 'Pessimista', 'profile-1')

    expect(scenario).toEqual({ id: 's-2', name: 'Pessimista', createdAt: '2026-08-01T00:00:00Z' })
    expect(scenarioInsert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, name: 'Pessimista', created_by: 'profile-1' })
    )
    expect(multiplierInsert).not.toHaveBeenCalled()
  })

  it('copies the source scenario multipliers when duplicating', async () => {
    const { multiplierInsert } = mockAdmin({
      scenarioLookup: { id: 's-1' },
      multiplierRowsByScenario: { 's-1': [{ ano: 2026, mes: 8, percentual: 85 }] },
      insertedScenario: { id: 's-2', name: 'Conservador (cópia)', created_at: '2026-08-01T00:00:00Z' },
    })

    await createForecastScenario(ORG_ID, 'Conservador (cópia)', 'profile-1', 's-1')

    expect(multiplierInsert).toHaveBeenCalledWith([
      expect.objectContaining({ scenario_id: 's-2', ano: 2026, mes: 8, percentual: 85 }),
    ])
  })

  it('rejects duplicating from a scenario that does not belong to the org', async () => {
    mockAdmin({ scenarioLookup: null })

    await expect(createForecastScenario(ORG_ID, 'Cópia', 'profile-1', 's-foreign')).rejects.toThrow(
      'Cenário de origem não encontrado'
    )
  })
})

describe('updateScenarioMultiplier', () => {
  afterEach(() => vi.restoreAllMocks())

  it('upserts the multiplier when the scenario belongs to the org', async () => {
    const { multiplierUpsert } = mockAdmin({ scenarioLookup: { id: 's-1' } })

    await updateScenarioMultiplier(ORG_ID, 's-1', 2026, 8, 90)

    expect(multiplierUpsert).toHaveBeenCalledWith(
      { scenario_id: 's-1', ano: 2026, mes: 8, percentual: 90 },
      { onConflict: 'scenario_id,ano,mes' }
    )
  })

  it('rejects updating a scenario that does not belong to the org', async () => {
    mockAdmin({ scenarioLookup: null })

    await expect(updateScenarioMultiplier(ORG_ID, 's-foreign', 2026, 8, 90)).rejects.toThrow('Cenário não encontrado')
  })
})
