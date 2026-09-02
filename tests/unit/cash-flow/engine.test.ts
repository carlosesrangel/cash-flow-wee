import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadCashFlowEntries, resolveOpeningBalance, type CashFlowEntry } from '@/lib/cash-flow/engine'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

function makeEntry(overrides: Partial<CashFlowEntry> & { id: string; date: string; amount: number }): CashFlowEntry {
  return {
    origin: 'manual',
    sourceId: overrides.id,
    direction: 'entrada',
    bucket: 'realizado',
    description: null,
    ...overrides,
  }
}

type Row = Record<string, unknown>

function makePageableChain(rows: Row[]) {
  let from = 0
  let to = 499
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.not = vi.fn(() => chain)
  chain.is = vi.fn(() => chain)
  chain.range = vi.fn((nextFrom: number, nextTo: number) => {
    from = nextFrom
    to = nextTo
    return chain
  })
  chain.then = (resolve: (value: { data: Row[]; error: null }) => unknown) =>
    resolve({ data: rows.slice(from, to + 1), error: null })
  return chain
}

function mockAdmin(options: {
  arRows?: Row[]
  apRows?: Row[]
  manualRows?: Row[]
  linkedRows?: Row[]
  snapshot?: Row | null
  adjustmentRows?: Row[]
  contactRows?: Row[]
  orderRows?: Row[]
  orderItemRows?: Row[]
}) {
  const arRows = options.arRows ?? []
  const apRows = options.apRows ?? []
  const manualRows = options.manualRows ?? []
  const linkedRows = options.linkedRows ?? []
  const adjustmentRows = options.adjustmentRows ?? []
  const contactRows = options.contactRows ?? []
  const orderRows = options.orderRows ?? []
  const orderItemRows = options.orderItemRows ?? []

  const snapshotChain: Record<string, unknown> = {}
  snapshotChain.eq = vi.fn(() => snapshotChain)
  snapshotChain.lt = vi.fn(() => snapshotChain)
  snapshotChain.order = vi.fn(() => snapshotChain)
  snapshotChain.limit = vi.fn(() => snapshotChain)
  snapshotChain.maybeSingle = vi.fn(() => Promise.resolve({ data: options.snapshot ?? null, error: null }))

  // The `manual_cash_entries` table is queried two different ways by
  // engine.ts: `loadManualEntries` pages through it (.eq/.is/.in/.range/.then)
  // while `resolveOpeningBalance` filters ajuste_saldo rows by date range
  // (.eq/.is/.gt/.lt/.range/.then). Both shapes have to be served off the
  // same chain object since both call `admin.from('manual_cash_entries')`;
  // `.gt`/`.lt` hand off to their own pageable chain (mirroring
  // `makePageableChain`) so `resolveOpeningBalance`'s `fetchAllPages` call
  // pages through `adjustmentRows` exactly like the other reads.
  const from = vi.fn((table: string) => {
    if (table === 'olist_accounts_receivable') return { select: vi.fn(() => makePageableChain(arRows)) }
    if (table === 'olist_accounts_payable') return { select: vi.fn(() => makePageableChain(apRows)) }
    if (table === 'manual_cash_entries') {
      return {
        select: vi.fn(() => {
          const chain = makePageableChain(manualRows)
          chain.gt = vi.fn(() => ({
            lt: vi.fn(() => makePageableChain(adjustmentRows)),
          }))
          return chain
        }),
      }
    }
    if (table === 'reconciliation_matches') return { select: vi.fn(() => makePageableChain(linkedRows)) }
    if (table === 'cash_balance_snapshots') return { select: vi.fn(() => snapshotChain) }
    if (table === 'olist_contacts') return { select: vi.fn(() => makePageableChain(contactRows)) }
    if (table === 'olist_orders') return { select: vi.fn(() => makePageableChain(orderRows)) }
    if (table === 'olist_order_items') return { select: vi.fn(() => makePageableChain(orderItemRows)) }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
}

describe('loadCashFlowEntries', () => {
  afterEach(() => vi.restoreAllMocks())

  it('includes a contratado AR entry and excludes a cancelado AP entry in the same call', async () => {
    mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          saldo: 380,
          situacao: 'aberto',
          data_vencimento: '2026-09-01',
          data_liquidacao: null,
          historico: 'Ref. NF 1',
          numero_documento: '000001/01',
        },
      ],
      apRows: [
        {
          id: 'ap-1',
          valor: 500,
          saldo: 500,
          situacao: 'cancelado',
          data_vencimento: '2026-09-05',
          historico: 'Frete',
          numero_documento: 'F-1',
        },
      ],
    })

    const entries = await loadCashFlowEntries(ORG_ID)

    expect(entries).toEqual([
      {
        id: 'ar-ar-1',
        origin: 'ar',
        sourceId: 'ar-1',
        date: '2026-09-01',
        amount: 380,
        direction: 'entrada',
        bucket: 'contratado',
        description: '000001/01',
      },
    ])
  })

  it('dates a reconciled AR entry by the linked SumUp event due_date, not data_vencimento', async () => {
    mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          saldo: 380,
          situacao: 'aberto',
          data_vencimento: '2026-09-01',
          data_liquidacao: null,
          historico: null,
          numero_documento: '000001/01',
        },
      ],
      linkedRows: [
        {
          olist_accounts_receivable_id: 'ar-1',
          status: 'reconciliado_automaticamente',
          match_reason: { v2_classification: 'VERIFIED_COMPOSITE' },
          sumup_transaction_events: { due_date: '2026-08-28' },
        },
      ],
    })

    const entries = await loadCashFlowEntries(ORG_ID)

    expect(entries[0]).toMatchObject({ date: '2026-08-28', bucket: 'contratado' })
  })

  it('includes a realizado manual entrada/saida and excludes ajuste_saldo from the flat entry list', async () => {
    mockAdmin({
      manualRows: [
        { id: 'm-1', type: 'entrada', amount: 100, entry_date: '2026-08-15', description: 'Venda avulsa' },
      ],
    })

    const entries = await loadCashFlowEntries(ORG_ID)

    expect(entries).toEqual([
      {
        id: 'manual-m-1',
        origin: 'manual',
        sourceId: 'm-1',
        date: '2026-08-15',
        amount: 100,
        direction: 'entrada',
        bucket: 'realizado',
        description: 'Venda avulsa',
      },
    ])
  })
})

describe('resolveOpeningBalance', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns null when there is no snapshot before the given date', async () => {
    mockAdmin({ snapshot: null })
    expect(await resolveOpeningBalance(ORG_ID, '2026-08-15', [])).toBeNull()
  })

  it('sums bank_balance, cash_on_hand, and liquid_investments from the latest applicable snapshot', async () => {
    mockAdmin({
      snapshot: {
        reference_date: '2026-08-01',
        bank_balance: 10000,
        cash_on_hand: 500,
        liquid_investments: 2000,
      },
      adjustmentRows: [],
    })

    const result = await resolveOpeningBalance(ORG_ID, '2026-08-15', [])

    expect(result).toEqual({ balance: 12500, asOf: '2026-08-01' })
  })

  it('adds ajuste_saldo entries strictly between the snapshot and the target date', async () => {
    mockAdmin({
      snapshot: { reference_date: '2026-08-01', bank_balance: 10000, cash_on_hand: null, liquid_investments: null },
      adjustmentRows: [{ amount: -300 }, { amount: 50 }],
    })

    const result = await resolveOpeningBalance(ORG_ID, '2026-08-15', [])

    expect(result).toEqual({ balance: 9750, asOf: '2026-08-01' })
  })

  it('adds realizado entries dated strictly between the snapshot and the target date', async () => {
    mockAdmin({
      snapshot: { reference_date: '2026-08-01', bank_balance: 10000, cash_on_hand: null, liquid_investments: null },
      adjustmentRows: [],
    })

    const result = await resolveOpeningBalance(ORG_ID, '2026-08-15', [
      makeEntry({ id: 'in-gap-entrada', date: '2026-08-05', amount: 700, direction: 'entrada' }),
      makeEntry({ id: 'in-gap-saida', date: '2026-08-07', amount: 250, direction: 'saida' }),
      // boundary + outside-the-gap entries must be ignored: the snapshot
      // already accounts for its own reference_date, and anything from the
      // target date onward belongs to the displayed window, not the opening.
      makeEntry({ id: 'on-snapshot-date', date: '2026-08-01', amount: 999, direction: 'entrada' }),
      makeEntry({ id: 'on-target-date', date: '2026-08-15', amount: 999, direction: 'entrada' }),
      makeEntry({ id: 'after-target-date', date: '2026-08-20', amount: 999, direction: 'entrada' }),
    ])

    expect(result).toEqual({ balance: 10450, asOf: '2026-08-01' })
  })

  it('ignores contratado entries in the gap so an unrealized flow never blends into the confirmed balance', async () => {
    mockAdmin({
      snapshot: { reference_date: '2026-08-01', bank_balance: 10000, cash_on_hand: null, liquid_investments: null },
      adjustmentRows: [],
    })

    const result = await resolveOpeningBalance(ORG_ID, '2026-08-15', [
      makeEntry({ id: 'gap-contratado', date: '2026-08-05', amount: 700, direction: 'entrada', bucket: 'contratado' }),
    ])

    expect(result).toEqual({ balance: 10000, asOf: '2026-08-01' })
  })
})
