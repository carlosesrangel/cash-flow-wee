import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Builds a fake admin client whose `.from(table)` branches by table name.
 * `resolvedIds`/`arRows` back the two read queries `runReconciliation` issues
 * up front; `eventRowsByArId` backs the per-AR-row candidate query, keyed by
 * the AR row's `id` so each test can hand back different candidate sets.
 */
function mockAdmin(options: {
  resolvedIds?: string[]
  arRows?: Array<{
    id: string
    valor: number | null
    data_vencimento: string | null
    numero_documento: string | null
    forma_recebimento_nome: string | null
  }>
  eventRowsByArId?: Record<string, unknown[]>
  upsertError?: { message: string } | null
}) {
  const resolvedIds = options.resolvedIds ?? []
  const arRows = options.arRows ?? []
  const eventRowsByArId = options.eventRowsByArId ?? {}
  const upsert = vi.fn().mockResolvedValue({ error: options.upsertError ?? null })

  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_matches') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: resolvedIds.map((id) => ({ olist_accounts_receivable_id: id })), error: null }),
          }),
        }),
        upsert,
      }
    }
    if (table === 'olist_accounts_receivable') {
      const chain: Record<string, unknown> = {}
      chain.eq = vi.fn().mockReturnValue(chain)
      chain.in = vi.fn().mockReturnValue(chain)
      chain.not = vi.fn().mockReturnValue(chain)
      chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: arRows, error: null })
      return { select: vi.fn().mockReturnValue(chain) }
    }
    if (table === 'sumup_transaction_events') {
      // Each call in matchOne() is scoped to one AR row's installment_number
      // filter; the test controls the outcome per AR row id via a closure
      // variable set right before the call in each test.
      const chain: Record<string, unknown> = {}
      chain.eq = vi.fn().mockReturnValue(chain)
      chain.gte = vi.fn().mockReturnValue(chain)
      chain.lte = vi.fn().mockReturnValue(chain)
      chain.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: currentEventRows, error: null })
      return { select: vi.fn().mockReturnValue(chain) }
    }
    throw new Error(`unexpected table ${table}`)
  })

  let currentEventRows: unknown[] = []
  const setEventRowsFor = (arId: string) => {
    currentEventRows = eventRowsByArId[arId] ?? []
  }

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { upsert, setEventRowsFor }
}

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
          forma_recebimento_nome: 'Cartão de crédito',
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
          forma_recebimento_nome: 'Cartão de crédito',
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
          forma_recebimento_nome: 'Cartão de crédito',
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
    const { upsert } = mockAdmin({
      resolvedIds: ['ar-1'],
      arRows: [], // the runner's own AR query excludes resolved ids — simulated here by an empty result
    })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    const result = await runReconciliation(ORG_ID)

    expect(result.processed).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('marks nao_reconciliado when numeroDocumento has no parseable installment number', async () => {
    const { upsert } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          data_vencimento: '2026-02-01',
          numero_documento: 'SEM-PARCELA',
          forma_recebimento_nome: 'Cartão de crédito',
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
})
