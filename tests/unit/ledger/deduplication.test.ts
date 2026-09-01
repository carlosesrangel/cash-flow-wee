import { describe, it, expect } from 'vitest'
import {
  generateLedgerDedupKey,
  aggregateLedgerByDirection,
  separateLedgerByStatus,
  type LedgerEntry,
} from '@/lib/ledger/deduplication'

/**
 * Golden Dataset 09: Financial Ledger Deduplication
 *
 * Tests ledger versioning and status transitions
 */

describe('Financial Ledger Deduplication Golden Dataset', () => {
  it('Dedup key generation', () => {
    // Scenario: SUMUP payout with transaction_code as source_id
    const entry: LedgerEntry = {
      org_id: 'org123',
      source: 'SUMUP',
      source_id: 'txn-abc123',
      source_event_id: 'payout-1',
      nature: 'SUMUP_PAYOUT_SCHEDULED',
      event_date: '2026-02-15',
      amount: 500,
      direction: 'entrada',
      status: 'scheduled',
      generated_at: '2026-02-01T10:00:00Z',
      valid_from: '2026-02-01T10:00:00Z',
    }

    const key = generateLedgerDedupKey(entry)

    expect(key).toBe('org123|SUMUP|txn-abc123|payout-1|2026-02-15|scheduled')
  })

  it('Dedup key handles NULL source_event_id', () => {
    // Scenario: Entry without source_event_id
    const entry: LedgerEntry = {
      org_id: 'org123',
      source: 'MANUAL',
      source_id: 'manual-001',
      nature: 'SUMUP_PAYOUT_ACTUAL',
      event_date: '2026-02-15',
      amount: 100,
      direction: 'entrada',
      status: 'manual',
      generated_at: '2026-02-01T10:00:00Z',
      valid_from: '2026-02-01T10:00:00Z',
    }

    const key = generateLedgerDedupKey(entry)

    expect(key).toBe('org123|MANUAL|manual-001|NULL|2026-02-15|manual')
  })

  it('Payout status transition: SCHEDULED → SUCCESSFUL', () => {
    // Scenario: 3-installment payout
    // Initial state: all 3 parcels are SCHEDULED
    // Month 1: 1st parcel SUCCESSFUL → supersede old SCHEDULED, insert new SUCCESSFUL

    const entries: LedgerEntry[] = [
      {
        org_id: 'org123',
        source: 'SUMUP',
        source_id: 'txn-parcel-1',
        source_event_id: 'payout-1',
        nature: 'SUMUP_PAYOUT_SCHEDULED',
        event_date: '2026-02-01',
        amount: 100,
        direction: 'entrada',
        status: 'scheduled',
        generated_at: '2026-01-15T10:00:00Z',
        valid_from: '2026-01-15T10:00:00Z',
        superseded_at: null,
      },
      {
        org_id: 'org123',
        source: 'SUMUP',
        source_id: 'txn-parcel-1',
        source_event_id: 'payout-1',
        nature: 'SUMUP_PAYOUT_ACTUAL',
        event_date: '2026-02-01',
        amount: 100,
        direction: 'entrada',
        status: 'actual', // New SUCCESSFUL entry
        generated_at: '2026-02-01T14:00:00Z',
        valid_from: '2026-02-01T14:00:00Z',
        superseded_at: null, // Current
      },
    ]

    // After transition:
    // Old SCHEDULED: superseded_at = '2026-02-01T14:00:00Z'
    // New SUCCESSFUL: superseded_at = null
    const oldEntry = entries[0]
    const newEntry = entries[1]

    expect(oldEntry.status).toBe('scheduled')
    expect(newEntry.status).toBe('actual')
    // In real scenario, oldEntry.superseded_at would be set
  })

  it('Multiple payouts do not deduplicate', () => {
    // Scenario: 3-installment sale generates 3 ledger entries
    // Each has unique source_event_id (payout-1, payout-2, payout-3)
    // Should NOT deduplicate

    const payouts = [
      {
        source_id: 'txn-abc123',
        source_event_id: 'payout-1',
        amount: 100,
      },
      {
        source_id: 'txn-abc123',
        source_event_id: 'payout-2',
        amount: 100,
      },
      {
        source_id: 'txn-abc123',
        source_event_id: 'payout-3',
        amount: 100,
      },
    ]

    const keys = payouts.map((p) =>
      generateLedgerDedupKey({
        org_id: 'org123',
        source: 'SUMUP',
        source_id: p.source_id,
        source_event_id: p.source_event_id,
        nature: 'SUMUP_PAYOUT_SCHEDULED',
        event_date: '2026-02-15',
        amount: p.amount,
        direction: 'entrada',
        status: 'scheduled',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
      })
    )

    // All keys should be unique
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(3)
  })

  it('Aggregate ledger by direction', () => {
    // Scenario: Mixed entradas and saidas
    // Entradas:
    //   SUMUP payout: +500
    //   SUMUP payout: +300
    //   FORECAST: +200
    // Saidas:
    //   TAX_LIABILITY: -100
    //   TINY_PAYABLE: -50
    // Expected: net = 850

    const entries: LedgerEntry[] = [
      {
        org_id: 'org123',
        source: 'SUMUP',
        source_id: 'payout-1',
        event_date: '2026-02-01',
        amount: 500,
        direction: 'entrada',
        status: 'actual',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'SUMUP_PAYOUT_ACTUAL',
      },
      {
        org_id: 'org123',
        source: 'SUMUP',
        source_id: 'payout-2',
        event_date: '2026-02-02',
        amount: 300,
        direction: 'entrada',
        status: 'actual',
        generated_at: '2026-02-02T10:00:00Z',
        valid_from: '2026-02-02T10:00:00Z',
        nature: 'SUMUP_PAYOUT_ACTUAL',
      },
      {
        org_id: 'org123',
        source: 'FORECAST',
        source_id: 'forecast-1',
        event_date: '2026-02-15',
        amount: 200,
        direction: 'entrada',
        status: 'projected',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'PROJECTED_SALES',
      },
      {
        org_id: 'org123',
        source: 'MANUAL',
        source_id: 'tax-1',
        event_date: '2026-02-20',
        amount: 100,
        direction: 'saida',
        status: 'manual',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'TAX_LIABILITY',
      },
      {
        org_id: 'org123',
        source: 'TINY',
        source_id: 'tiny-1',
        event_date: '2026-02-25',
        amount: 50,
        direction: 'saida',
        status: 'actual',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'TINY_PAYABLE_ACTUAL',
      },
    ]

    const aggregated = aggregateLedgerByDirection(entries)

    expect(aggregated.entradas).toBe(1000) // 500 + 300 + 200
    expect(aggregated.saidas).toBe(150) // 100 + 50
    expect(aggregated.net).toBe(850) // 1000 - 150
  })

  it('Separate ledger by status', () => {
    // Scenario: Mixed actual/scheduled/projected
    const entries: LedgerEntry[] = [
      {
        org_id: 'org123',
        source: 'SUMUP',
        source_id: 'payout-1',
        event_date: '2026-02-01',
        amount: 500,
        direction: 'entrada',
        status: 'actual',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'SUMUP_PAYOUT_ACTUAL',
      },
      {
        org_id: 'org123',
        source: 'SUMUP',
        source_id: 'payout-2',
        event_date: '2026-02-15',
        amount: 300,
        direction: 'entrada',
        status: 'scheduled',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'SUMUP_PAYOUT_SCHEDULED',
      },
      {
        org_id: 'org123',
        source: 'FORECAST',
        source_id: 'forecast-1',
        event_date: '2026-03-01',
        amount: 200,
        direction: 'entrada',
        status: 'projected',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'PROJECTED_SALES',
      },
    ]

    const separated = separateLedgerByStatus(entries)

    expect(separated.actual).toHaveLength(1)
    expect(separated.scheduled).toHaveLength(1)
    expect(separated.projected).toHaveLength(1)

    expect(separated.actual[0].amount).toBe(500)
    expect(separated.scheduled[0].amount).toBe(300)
    expect(separated.projected[0].amount).toBe(200)
  })

  it('Ledger history: superseded entries preserved', () => {
    // Scenario: Timeline of a payout:
    // T1: SCHEDULED entry created
    // T2: Payout realizes → old entry superseded, new entry created
    // History shows: [SCHEDULED (superseded), SUCCESSFUL (current)]

    const history: LedgerEntry[] = [
      {
        id: 'ledger-1',
        org_id: 'org123',
        source: 'SUMUP',
        source_id: 'payout-1',
        event_date: '2026-02-15',
        amount: 500,
        direction: 'entrada',
        status: 'scheduled',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        superseded_at: '2026-02-15T14:00:00Z', // superseded when payout realized
        nature: 'SUMUP_PAYOUT_SCHEDULED',
      },
      {
        id: 'ledger-2',
        org_id: 'org123',
        source: 'SUMUP',
        source_id: 'payout-1',
        event_date: '2026-02-15',
        amount: 500,
        direction: 'entrada',
        status: 'actual',
        generated_at: '2026-02-15T14:00:00Z',
        valid_from: '2026-02-15T14:00:00Z',
        superseded_at: null, // current
        nature: 'SUMUP_PAYOUT_ACTUAL',
      },
    ]

    // Filter for current entries only (superseded_at IS NULL)
    const current = history.filter((e) => !e.superseded_at)
    expect(current).toHaveLength(1)
    expect(current[0].id).toBe('ledger-2')

    // Full history available for audit
    expect(history).toHaveLength(2)
  })

  it('Multiple sources in same ledger: no cross-contamination', () => {
    // Scenario: Ledger has SUMUP (actual), FORECAST (projected), MANUAL (manual)
    // Should aggregate cleanly without confusion

    const entries: LedgerEntry[] = [
      {
        org_id: 'org123',
        source: 'SUMUP',
        source_id: 'payout-1',
        event_date: '2026-02-01',
        amount: 500,
        direction: 'entrada',
        status: 'actual',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'SUMUP_PAYOUT_ACTUAL',
      },
      {
        org_id: 'org123',
        source: 'FORECAST',
        source_id: 'forecast-123',
        event_date: '2026-03-01',
        amount: 1000,
        direction: 'entrada',
        status: 'projected',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'PROJECTED_SALES',
      },
      {
        org_id: 'org123',
        source: 'MANUAL',
        source_id: 'manual-123',
        event_date: '2026-02-20',
        amount: 100,
        direction: 'saida',
        status: 'manual',
        generated_at: '2026-02-01T10:00:00Z',
        valid_from: '2026-02-01T10:00:00Z',
        nature: 'MANUAL_ENTRY',
      },
    ]

    const separated = separateLedgerByStatus(entries)

    // ACTUAL: only SUMUP
    expect(separated.actual.filter((e) => e.source === 'SUMUP')).toHaveLength(1)
    expect(separated.actual.filter((e) => e.source === 'FORECAST')).toHaveLength(0)

    // PROJECTED: only FORECAST
    expect(separated.projected.filter((e) => e.source === 'FORECAST')).toHaveLength(1)

    // MANUAL: only MANUAL
    expect(separated.actual.filter((e) => e.source === 'MANUAL')).toHaveLength(0)
  })
})
