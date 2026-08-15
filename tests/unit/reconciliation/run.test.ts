import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
/** Must match PAGE_SIZE in lib/reconciliation/run.ts. */
const PAGE_SIZE = 500

type ArRow = {
  id: string
  valor: number | null
  data_vencimento: string | null
  numero_documento: string | null
  forma_recebimento_nome: string | null
}

type StrandedRow = { id: string; olist_accounts_receivable_id: string }

type LinkedRow = { id: string; sumup_transaction_event_id: string; status: string; created_at: string }

/**
 * Builds a fake admin client whose `.from(table)` branches by table name.
 *
 * The read chains are thenable objects that honour `.range(from, to)` by
 * slicing their backing fixture array, so a fixture longer than `PAGE_SIZE`
 * genuinely exercises `runReconciliation`'s pagination loop.
 *
 * - `resolvedIds` backs the resolved-match id query (exclusion set).
 * - `arRows` backs the AR candidate query (and the repair pass's per-id
 *   `maybeSingle()` lookup).
 * - `strandedRows` backs the repair pass's
 *   `is('sumup_transaction_event_id', null)` query.
 * - `linkedRows` backs the duplicate-event-claim guard's
 *   `in('status', LINKED_STATUSES).not('sumup_transaction_event_id', 'is', null)`
 *   query.
 * - `eventRowsByArId` backs the per-AR-row candidate query, keyed by the AR
 *   row's `id`; each test picks the active set via `setEventRowsFor`.
 */
function mockAdmin(options: {
  resolvedIds?: string[]
  arRows?: ArRow[]
  strandedRows?: StrandedRow[]
  linkedRows?: LinkedRow[]
  eventRowsByArId?: Record<string, unknown[]>
  upsertError?: { message: string } | null
}) {
  const resolvedIds = options.resolvedIds ?? []
  const arRows = options.arRows ?? []
  const strandedRows = options.strandedRows ?? []
  const linkedRows = options.linkedRows ?? []
  const eventRowsByArId = options.eventRowsByArId ?? {}
  const upsert = vi.fn().mockResolvedValue({ error: options.upsertError ?? null })

  const gteCalls: Array<[string, unknown]> = []
  const lteCalls: Array<[string, unknown]> = []
  const rangeCallsByTable: Record<string, Array<[number, number]>> = {}
  const isCallsByTable: Record<string, Array<[string, unknown]>> = {}
  const updateCalls: Array<{ payload: Record<string, unknown>; matchId: unknown }> = []

  const update = vi.fn((payload: Record<string, unknown>) => ({
    eq: vi.fn((_column: string, value: unknown) => {
      updateCalls.push({ payload, matchId: value })
      return Promise.resolve({ error: null })
    }),
  }))

  let currentEventRows: unknown[] = []
  const setEventRowsFor = (arId: string) => {
    currentEventRows = eventRowsByArId[arId] ?? []
  }

  /**
   * A pageable thenable: filter methods return `this`, `.range()` records the
   * window, and awaiting it resolves the corresponding slice of `rows()`.
   */
  function makePageableChain(table: string, rows: () => unknown[]) {
    const ranges = (rangeCallsByTable[table] ??= [])
    const eqCalls: Array<[string, unknown]> = []
    let from = 0
    let to = PAGE_SIZE - 1
    const chain: Record<string, unknown> = {}
    chain.eq = vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value])
      return chain
    })
    chain.in = vi.fn(() => chain)
    chain.not = vi.fn(() => chain)
    chain.is = vi.fn((column: string, value: unknown) => {
      ;(isCallsByTable[table] ??= []).push([column, value])
      return chain
    })
    chain.gte = vi.fn((column: string, value: unknown) => {
      gteCalls.push([column, value])
      return chain
    })
    chain.lte = vi.fn((column: string, value: unknown) => {
      lteCalls.push([column, value])
      return chain
    })
    chain.range = vi.fn((nextFrom: number, nextTo: number) => {
      ranges.push([nextFrom, nextTo])
      from = nextFrom
      to = nextTo
      return chain
    })
    chain.maybeSingle = vi.fn(() => {
      const idCall = eqCalls.find(([column]) => column === 'id')
      const row = (rows() as ArRow[]).find((candidate) => candidate.id === idCall?.[1]) ?? null
      return Promise.resolve({ data: row, error: null })
    })
    chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows().slice(from, to + 1), error: null })
    return chain
  }

  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_matches') {
      return {
        select: vi.fn((columns: string) =>
          columns.includes('id, olist_accounts_receivable_id')
            ? makePageableChain('reconciliation_matches:stranded', () => strandedRows)
            : columns.includes('sumup_transaction_event_id')
              ? makePageableChain('reconciliation_matches:linked', () => linkedRows)
              : makePageableChain('reconciliation_matches:resolved', () =>
                  resolvedIds.map((id) => ({ olist_accounts_receivable_id: id }))
                )
        ),
        upsert,
        update,
      }
    }
    if (table === 'olist_accounts_receivable') {
      return { select: vi.fn(() => makePageableChain('olist_accounts_receivable', () => arRows)) }
    }
    if (table === 'sumup_transaction_events') {
      // matchOne() issues no `.range()` on this query; the chain resolves the
      // active event fixture regardless of the (unused) default window.
      const chain: Record<string, unknown> = {}
      chain.eq = vi.fn().mockReturnValue(chain)
      chain.gte = vi.fn((column: string, value: unknown) => {
        gteCalls.push([column, value])
        return chain
      })
      chain.lte = vi.fn((column: string, value: unknown) => {
        lteCalls.push([column, value])
        return chain
      })
      chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: currentEventRows, error: null })
      return { select: vi.fn().mockReturnValue(chain) }
    }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { upsert, update, updateCalls, setEventRowsFor, gteCalls, lteCalls, rangeCallsByTable, isCallsByTable }
}

const CARD = 'Cartão de crédito'

describe('runReconciliation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('marks nao_reconciliado when no candidate events exist', async () => {
    const { upsert, setEventRowsFor } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          data_vencimento: '2026-02-01',
          numero_documento: '000516/03',
          forma_recebimento_nome: CARD,
        },
      ],
      eventRowsByArId: { 'ar-1': [] },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    const result = await runReconciliation(ORG_ID)

    expect(result.processed).toBe(1)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ olist_accounts_receivable_id: 'ar-1', status: 'nao_reconciliado' }),
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )
  })

  it('marks reconciliado_automaticamente with exactly one matching candidate', async () => {
    const { upsert, setEventRowsFor } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 809.2,
          data_vencimento: '2026-02-01',
          numero_documento: '000516/10',
          forma_recebimento_nome: CARD,
        },
      ],
      eventRowsByArId: {
        'ar-1': [
          {
            id: 'event-1',
            due_date: '2026-02-02',
            installment_number: 10,
            sumup_transactions: { id: 'tx-1', amount: 8092, installments_count: 10, status: 'SUCCESSFUL' },
          },
        ],
      },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        olist_accounts_receivable_id: 'ar-1',
        status: 'reconciliado_automaticamente',
        sumup_transaction_id: 'tx-1',
        sumup_transaction_event_id: 'event-1',
      }),
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )
  })

  it('marks conflito with more than one matching candidate and records every candidate id', async () => {
    const { upsert, setEventRowsFor } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 809.2,
          data_vencimento: '2026-02-01',
          numero_documento: '000516/10',
          forma_recebimento_nome: CARD,
        },
      ],
      eventRowsByArId: {
        'ar-1': [
          {
            id: 'event-1',
            due_date: '2026-02-02',
            installment_number: 10,
            sumup_transactions: { id: 'tx-1', amount: 8092, installments_count: 10, status: 'SUCCESSFUL' },
          },
          {
            id: 'event-2',
            due_date: '2026-02-03',
            installment_number: 10,
            sumup_transactions: { id: 'tx-2', amount: 8092, installments_count: 10, status: 'SUCCESSFUL' },
          },
        ],
      },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        olist_accounts_receivable_id: 'ar-1',
        status: 'conflito',
        candidate_ids: ['event-1', 'event-2'],
        sumup_transaction_id: null,
        sumup_transaction_event_id: null,
      }),
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )
  })

  it('never reprocesses an AR row that already has a resolved reconciliation_matches row', async () => {
    // The AR query returns BOTH rows; the resolved one must be dropped by the
    // runner's own client-side exclusion, not pre-filtered by the fixture.
    const { upsert, setEventRowsFor } = mockAdmin({
      resolvedIds: ['ar-1'],
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          data_vencimento: '2026-02-01',
          numero_documento: '000516/03',
          forma_recebimento_nome: CARD,
        },
        {
          id: 'ar-2',
          valor: 380,
          data_vencimento: '2026-02-01',
          numero_documento: '000516/04',
          forma_recebimento_nome: CARD,
        },
      ],
    })
    setEventRowsFor('ar-2')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    const result = await runReconciliation(ORG_ID)

    expect(result.processed).toBe(1)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ olist_accounts_receivable_id: 'ar-2' }),
      expect.anything()
    )
  })

  it('marks nao_reconciliado when numeroDocumento has no parseable installment number', async () => {
    const { upsert } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          data_vencimento: '2026-02-01',
          numero_documento: 'SEM-PARCELA',
          forma_recebimento_nome: CARD,
        },
      ],
    })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ olist_accounts_receivable_id: 'ar-1', status: 'nao_reconciliado' }),
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )
  })

  // --- date window -----------------------------------------------------

  it('queries the sumup event due_date window as exactly ±5 calendar days, timezone-independently', async () => {
    const { setEventRowsFor, gteCalls, lteCalls } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          data_vencimento: '2026-02-01',
          numero_documento: '000516/03',
          forma_recebimento_nome: CARD,
        },
      ],
      eventRowsByArId: { 'ar-1': [] },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(gteCalls.filter(([column]) => column === 'due_date')).toEqual([['due_date', '2026-01-27']])
    expect(lteCalls.filter(([column]) => column === 'due_date')).toEqual([['due_date', '2026-02-06']])
  })

  it('keeps the ±5-day window correct across a month/year boundary', async () => {
    const { setEventRowsFor, gteCalls, lteCalls } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          data_vencimento: '2026-01-03',
          numero_documento: '000516/03',
          forma_recebimento_nome: CARD,
        },
      ],
      eventRowsByArId: { 'ar-1': [] },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(gteCalls.filter(([column]) => column === 'due_date')).toEqual([['due_date', '2025-12-29']])
    expect(lteCalls.filter(([column]) => column === 'due_date')).toEqual([['due_date', '2026-01-08']])
  })

  // --- pagination ------------------------------------------------------

  it('paginates the AR candidate query and processes every row across pages', async () => {
    const arRows: ArRow[] = Array.from({ length: PAGE_SIZE + 3 }, (_, index) => ({
      id: `ar-${index}`,
      valor: 380,
      data_vencimento: '2026-02-01',
      numero_documento: '000516/03',
      forma_recebimento_nome: CARD,
    }))
    const { upsert, rangeCallsByTable } = mockAdmin({ arRows })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    const result = await runReconciliation(ORG_ID)

    expect(result.processed).toBe(PAGE_SIZE + 3)
    expect(upsert).toHaveBeenCalledTimes(PAGE_SIZE + 3)
    expect(rangeCallsByTable['olist_accounts_receivable']).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    ])
  })

  it('paginates the resolved-ids query so the exclusion set is never truncated', async () => {
    // PAGE_SIZE + 1 resolved ids: the last one only appears on page 2, and it
    // must still exclude its AR row.
    const resolvedIds = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => `ar-${index}`)
    const arRows: ArRow[] = resolvedIds.map((id) => ({
      id,
      valor: 380,
      data_vencimento: '2026-02-01',
      numero_documento: '000516/03',
      forma_recebimento_nome: CARD,
    }))
    const { upsert, rangeCallsByTable } = mockAdmin({ resolvedIds, arRows })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    const result = await runReconciliation(ORG_ID)

    expect(rangeCallsByTable['reconciliation_matches:resolved']).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
    ])
    expect(result.processed).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
  })

  // --- repair pass -----------------------------------------------------

  const strandedArRow: ArRow = {
    id: 'ar-1',
    valor: 809.2,
    data_vencimento: '2026-02-01',
    numero_documento: '000516/10',
    forma_recebimento_nome: CARD,
  }
  const relinkEvent = {
    id: 'event-9',
    due_date: '2026-02-02',
    installment_number: 10,
    sumup_transactions: { id: 'tx-9', amount: 8092, installments_count: 10, status: 'SUCCESSFUL' },
  }

  it('re-links a resolved match whose sumup FKs were nulled, without touching its resolution fields', async () => {
    const { update, updateCalls, upsert, setEventRowsFor } = mockAdmin({
      resolvedIds: ['ar-1'],
      arRows: [strandedArRow],
      strandedRows: [{ id: 'match-1', olist_accounts_receivable_id: 'ar-1' }],
      eventRowsByArId: { 'ar-1': [relinkEvent] },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(upsert).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateCalls[0].matchId).toBe('match-1')
    expect(updateCalls[0].payload).toEqual({
      sumup_transaction_id: 'tx-9',
      sumup_transaction_event_id: 'event-9',
      updated_at: expect.any(String),
    })
    expect(updateCalls[0].payload).not.toHaveProperty('status')
    expect(updateCalls[0].payload).not.toHaveProperty('resolved_by')
    expect(updateCalls[0].payload).not.toHaveProperty('resolved_at')
  })

  it('leaves a stranded resolved match untouched when no re-link candidate is found', async () => {
    const { update, setEventRowsFor } = mockAdmin({
      resolvedIds: ['ar-1'],
      arRows: [strandedArRow],
      strandedRows: [{ id: 'match-1', olist_accounts_receivable_id: 'ar-1' }],
      eventRowsByArId: { 'ar-1': [] },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(update).not.toHaveBeenCalled()
  })

  it('leaves a stranded resolved match untouched (never demoted) when the re-link is ambiguous', async () => {
    const { update, setEventRowsFor } = mockAdmin({
      resolvedIds: ['ar-1'],
      arRows: [strandedArRow],
      strandedRows: [{ id: 'match-1', olist_accounts_receivable_id: 'ar-1' }],
      eventRowsByArId: {
        'ar-1': [
          relinkEvent,
          {
            id: 'event-10',
            due_date: '2026-02-03',
            installment_number: 10,
            sumup_transactions: { id: 'tx-10', amount: 8092, installments_count: 10, status: 'SUCCESSFUL' },
          },
        ],
      },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(update).not.toHaveBeenCalled()
  })

  it('never fetches resolved matches that still have their sumup_transaction_event_id set', async () => {
    // The repair query filters `is('sumup_transaction_event_id', null)`, so a
    // healthy resolved row simply never appears in `strandedRows`.
    const { update, upsert, isCallsByTable } = mockAdmin({
      resolvedIds: ['ar-1'],
      arRows: [strandedArRow],
      strandedRows: [],
      eventRowsByArId: { 'ar-1': [relinkEvent] },
    })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    const result = await runReconciliation(ORG_ID)

    expect(isCallsByTable['reconciliation_matches:stranded']).toEqual([['sumup_transaction_event_id', null]])
    expect(result.processed).toBe(0)
    expect(update).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('runReconciliation — duplicate event claim guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('demotes the newer of two auto-matched rows claiming the same SumUp event to conflito', async () => {
    const { update, updateCalls, upsert } = mockAdmin({
      linkedRows: [
        {
          id: 'match-old',
          sumup_transaction_event_id: 'event-shared',
          status: 'reconciliado_automaticamente',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'match-new',
          sumup_transaction_event_id: 'event-shared',
          status: 'reconciliado_automaticamente',
          created_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(upsert).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateCalls[0].matchId).toBe('match-new')
    expect(updateCalls[0].payload).toEqual({
      status: 'conflito',
      sumup_transaction_id: null,
      sumup_transaction_event_id: null,
      resolved_by: null,
      resolved_at: null,
      match_reason: { motivo: 'evento_sumup_reivindicado_por_outra_parcela' },
      candidate_ids: ['event-shared'],
      updated_at: expect.any(String),
    })
  })

  it('keeps a reconciliado_manualmente row over a reconciliado_automaticamente row claiming the same event, regardless of creation order', async () => {
    const { update, updateCalls } = mockAdmin({
      linkedRows: [
        {
          id: 'match-auto',
          sumup_transaction_event_id: 'event-shared',
          status: 'reconciliado_automaticamente',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'match-manual',
          sumup_transaction_event_id: 'event-shared',
          status: 'reconciliado_manualmente',
          created_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(update).toHaveBeenCalledTimes(1)
    expect(updateCalls[0].matchId).toBe('match-auto')
    expect(updateCalls[0].payload).toMatchObject({ status: 'conflito' })
  })

  it('does not touch rows whose sumup_transaction_event_id is unique among resolved rows', async () => {
    const { update } = mockAdmin({
      linkedRows: [
        {
          id: 'match-a',
          sumup_transaction_event_id: 'event-a',
          status: 'reconciliado_automaticamente',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'match-b',
          sumup_transaction_event_id: 'event-b',
          status: 'reconciliado_automaticamente',
          created_at: '2026-01-02T00:00:00.000Z',
        },
      ],
    })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(update).not.toHaveBeenCalled()
  })
})
