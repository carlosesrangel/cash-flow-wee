import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadAllVersions, loadVersionEntries, loadScenarios, loadRealizadoByMonth } from '@/lib/forecast/engine'

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
}) {
  const versionRows = options.versionRows ?? []
  const entryRows = options.entryRows ?? []
  const scenarioRows = options.scenarioRows ?? []
  const multiplierRowsByScenario = options.multiplierRowsByScenario ?? {}
  const orderRows = options.orderRows ?? []

  const from = vi.fn((table: string) => {
    if (table === 'forecast_versions') {
      return {
        select: vi.fn((columns: string) => {
          if (columns === 'id') return makeSingleChain(options.versionLookup ?? null)
          return makePageableChain(versionRows)
        }),
      }
    }
    if (table === 'forecast_entries') return { select: vi.fn(() => makePageableChain(entryRows)) }
    if (table === 'forecast_scenarios') return { select: vi.fn(() => makePageableChain(scenarioRows)) }
    if (table === 'forecast_scenario_multipliers') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, scenarioId: string) => makePageableChain(multiplierRowsByScenario[scenarioId] ?? [])),
        })),
      }
    }
    if (table === 'olist_orders') return { select: vi.fn(() => makePageableChain(orderRows)) }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
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
