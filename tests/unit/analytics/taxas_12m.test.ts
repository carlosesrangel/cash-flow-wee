import { describe, it, expect } from 'vitest'
import { calculateTaxas12m } from '@/lib/analytics/taxas_12m'
import { createMockSupabaseClient } from '../../mocks/supabase'

/**
 * Golden Dataset 01: Taxas_12M
 *
 * MANDATORY: These tests MUST call calculateTaxas12m() with real mocked data.
 * NOT permitted: pre-calculating expected values locally and validating own math.
 */

describe('Taxas_12M - GD01', () => {
  let mockAdmin: ReturnType<typeof createMockSupabaseClient>

  // Case A: Simple complete payout (100 with 2 fee) produces 2% rate
  it('Case A: Single complete transaction/payout = 2% rate', async () => {
    const transactions = [
      {
        id: 'tx1',
        org_id: 'org1',
        type: 'PAYMENT',
        transaction_code: 'CODE001',
        timestamp_utc: '2026-01-15T10:00:00Z',
        amount: 100,
        fee_amount: 2,
        status: 'SUCCESSFUL',
        payment_type: 'CARD',
        card_type: 'CREDIT',
        installments_count: 1,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        payouts_total: 1,
        payouts_received: 1,
      },
    ]

    const payouts = [
      {
        org_id: 'org1',
        type: 'PAYOUT',
        status: 'SUCCESSFUL',
        transaction_code: 'CODE001',
        payout_date: '2026-01-15',
        fee: 2,
        amount: 100,
      },
    ]

    // Create mock with table data
    mockAdmin = createMockSupabaseClient({
      sumup_transactions: transactions,
      sumup_payouts: payouts,
    })

    // MANDATORY: Call the real function
    const result = await calculateTaxas12m(mockAdmin, 'org1')

    // Validate
    expect(result).toHaveLength(1)
    const metric = result[0]
    expect(metric.qtd_transacoes_12m).toBe(1)
    expect(metric.valor_bruto_12m).toBe(100)
    expect(metric.qtd_com_fee).toBe(1)
    expect(metric.fee_total_12m).toBe(2)
    expect(metric.taxa_media_simples).toBe(0.02) // 2 / 100
  })

  // Case B: Multiple payouts
  it('Case B: 300 sale with 3 payouts (each 3 fee) = 3% rate', async () => {
    const transactions = [
      {
        id: 'tx2',
        org_id: 'org1',
        type: 'PAYMENT',
        transaction_code: 'CODE002',
        timestamp_utc: '2026-02-10T10:00:00Z',
        amount: 300,
        fee_amount: null,
        status: 'SUCCESSFUL',
        payment_type: 'CARD',
        card_type: 'CREDIT',
        installments_count: 3,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        payouts_total: 3,
        payouts_received: 3,
      },
    ]

    const payouts = [
      { org_id: 'org1', type: 'PAYOUT', status: 'SUCCESSFUL', transaction_code: 'CODE002', payout_date: '2026-02-10', fee: 3, amount: 100 },
      { org_id: 'org1', type: 'PAYOUT', status: 'SUCCESSFUL', transaction_code: 'CODE002', payout_date: '2026-02-10', fee: 3, amount: 100 },
      { org_id: 'org1', type: 'PAYOUT', status: 'SUCCESSFUL', transaction_code: 'CODE002', payout_date: '2026-02-10', fee: 3, amount: 100 },
    ]

    mockAdmin = createMockSupabaseClient({
      sumup_transactions: transactions,
      sumup_payouts: payouts,
    })

    const result = await calculateTaxas12m(mockAdmin, 'org1')

    expect(result).toHaveLength(1)
    const metric = result[0]
    expect(metric.qtd_transacoes_12m).toBe(1)
    expect(metric.valor_bruto_12m).toBe(300)
    expect(metric.qtd_com_fee).toBe(1)
    expect(metric.fee_total_12m).toBe(9) // 3 + 3 + 3
    expect(metric.taxa_media_simples).toBeCloseTo(0.03, 5)
  })

  // Case C: Partial payout - CRITICAL
  it('Case C: Partial payout (600, 2/6 received) excludes from fee metrics', async () => {
    const transactions = [
      {
        id: 'tx3',
        org_id: 'org1',
        type: 'PAYMENT',
        transaction_code: 'CODE003',
        timestamp_utc: '2026-03-05T10:00:00Z',
        amount: 600,
        fee_amount: null,
        status: 'SUCCESSFUL',
        payment_type: 'CARD',
        card_type: 'CREDIT',
        installments_count: 6,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        payouts_total: 6,
        payouts_received: 2, // PARTIAL
      },
    ]

    const payouts = [
      { org_id: 'org1', type: 'PAYOUT', status: 'SUCCESSFUL', transaction_code: 'CODE003', payout_date: '2026-03-10', fee: 2, amount: 100 },
      { org_id: 'org1', type: 'PAYOUT', status: 'SUCCESSFUL', transaction_code: 'CODE003', payout_date: '2026-03-10', fee: 2, amount: 100 },
      // Only 2/6 received, so others not in data yet
    ]

    mockAdmin = createMockSupabaseClient({
      sumup_transactions: transactions,
      sumup_payouts: payouts,
    })

    const result = await calculateTaxas12m(mockAdmin, 'org1')

    // Critical: transaction counts in totals
    expect(result).toHaveLength(1)
    const metric = result[0]
    expect(metric.qtd_transacoes_12m).toBe(1) // Still counts
    expect(metric.valor_bruto_12m).toBe(600) // Still counts

    // But NOT in fee metrics
    expect(metric.qtd_com_fee).toBe(0) // Excluded: partial payout
    expect(metric.fee_total_12m).toBe(0) // Excluded
    expect(metric.taxa_media_simples).toBeNull() // No valid fee data
  })

  // Invariant tests
  it('Invariant: SUM(pct_valor) = 1.0 for single modality', async () => {
    const transactions = [
      {
        id: 'tx4',
        org_id: 'org1',
        type: 'PAYMENT',
        transaction_code: 'CODE004',
        timestamp_utc: '2026-04-20T10:00:00Z',
        amount: 150,
        fee_amount: 3,
        status: 'SUCCESSFUL',
        payment_type: 'CARD',
        card_type: 'CREDIT',
        installments_count: 1,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        payouts_total: 1,
        payouts_received: 1,
      },
    ]

    const payouts = [{ org_id: 'org1', type: 'PAYOUT', status: 'SUCCESSFUL', transaction_code: 'CODE004', payout_date: '2026-04-20', fee: 3, amount: 150 }]

    mockAdmin = createMockSupabaseClient({
      sumup_transactions: transactions,
      sumup_payouts: payouts,
    })

    const result = await calculateTaxas12m(mockAdmin, 'org1')

    const sumPct = result.reduce((sum, m) => sum + m.pct_valor_12m, 0)
    expect(sumPct).toBeCloseTo(1.0, 4)
  })
})
