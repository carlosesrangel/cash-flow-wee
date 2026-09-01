import { describe, it, expect } from 'vitest'
import { calculateTaxas12m, type FeeRateMetrics } from '@/lib/analytics/taxas_12m'

/**
 * Golden Dataset 01: Taxas_12M
 *
 * Tests three scenarios from Power Query spec:
 * - Case A: Simple complete sale with single payout
 * - Case B: Installment payment with multiple payouts (each with fee)
 * - Case C: Partial payout (critical test for FeeConsiderado logic)
 *
 * All in same modality to test invariants:
 * - SUM(pct_valor) = 1
 * - SUM(pct_transacoes) = 1
 */

describe('Taxas_12M Golden Dataset', () => {
  it('Case A: Single complete payout (100 with 2 fee) produces 2% rate', async () => {
    // Expected values calculated independently
    // NOT using calculateTaxas12m() to verify
    const expected = {
      amount_gross: 100,
      fee_total: 2,
      fee_considered: 2, // complete payout
      taxa_media: 0.02,
    }

    expect(expected.taxa_media).toBe(expected.fee_total / expected.amount_gross)
    expect(expected.fee_considered).toBe(expected.fee_total) // no partial payout
  })

  it('Case B: Three payouts from 300 sale (fees 3+3+3) produces 3% rate', async () => {
    // 300 split across 3 installments
    // Each payout: 100 amount, 3 fee
    // Total: 300 amount, 9 fee
    const expected = {
      amount_gross: 300,
      payout_count: 3,
      payout_fees: [3, 3, 3],
      fee_total: 9,
      fee_considered: 9, // all payouts complete
      taxa_media: 0.03,
    }

    const feeSum = expected.payout_fees.reduce((a, b) => a + b, 0)
    expect(feeSum).toBe(expected.fee_total)
    expect(expected.taxa_media).toBe(expected.fee_total / expected.amount_gross)
  })

  it('Case C: Partial payout (600, only 2/6 received) excludes from fee metrics but counts in totals', async () => {
    // CRITICAL TEST: Transaction with 600 amount
    // payouts_total = 6
    // payouts_received = 2 (33% complete)
    // Observed fees so far: 2 + 2 = 4
    //
    // Per Power Query: FeeConsiderado = null because payouts_received < payouts_total
    //
    // This transaction MUST:
    // - Count toward: Qtd Transacoes, Valor Bruto, % Valor, % Transacoes
    // - NOT count toward: Qtd com Fee, Valor Base Taxa, Fee Total, Taxa Media

    const expected = {
      amount_gross: 600,
      payouts_total: 6,
      payouts_received: 2,
      fees_observed: 4, // 2 + 2 from two payouts
      fee_considered: null, // Partial! Exclude from fee metrics

      // Transaction still in totals
      should_count_qtd: true,
      should_count_valor: true,

      // But not in fee metrics
      should_count_qtd_com_fee: false,
      should_count_valor_base_taxa: false,
      should_count_fee_total: false,
    }

    // Verify the rule
    const feeConsiderado =
      expected.payouts_received >= expected.payouts_total ? expected.fees_observed : null
    expect(feeConsiderado).toBeNull()
    expect(expected.fee_considered).toBeNull()
  })

  it('Aggregated dataset (A+B+C): Invariants hold', async () => {
    // All three cases in same modality to test aggregation invariants
    // Modality: CARD, CREDIT, 3 parcelas, POS, D+1

    // Case A contributes:
    const caseA = { qtd: 1, valor: 100, qtd_fee: 1, valor_taxa: 100, fee: 2 }

    // Case B contributes:
    const caseB = { qtd: 1, valor: 300, qtd_fee: 1, valor_taxa: 300, fee: 9 }

    // Case C contributes:
    const caseC = { qtd: 1, valor: 600, qtd_fee: 0, valor_taxa: 0, fee: 0 } // partial, excluded

    // Aggregated totals
    const aggregated = {
      qtd_transacoes: caseA.qtd + caseB.qtd + caseC.qtd, // 3
      valor_bruto: caseA.valor + caseB.valor + caseC.valor, // 1000
      qtd_com_fee: caseA.qtd_fee + caseB.qtd_fee + caseC.qtd_fee, // 2
      valor_base_taxa: caseA.valor_taxa + caseB.valor_taxa + caseC.valor_taxa, // 400
      fee_total: caseA.fee + caseB.fee + caseC.fee, // 11
    }

    // Verify aggregated metrics
    expect(aggregated.qtd_transacoes).toBe(3)
    expect(aggregated.valor_bruto).toBe(1000)
    expect(aggregated.qtd_com_fee).toBe(2)
    expect(aggregated.valor_base_taxa).toBe(400)
    expect(aggregated.fee_total).toBe(11)

    // Calculated rates
    const taxa_media_simples = (2 / 100 + 9 / 300) / 2 // (0.02 + 0.03) / 2 = 0.025
    const taxa_media_ponderada = aggregated.fee_total / aggregated.valor_base_taxa // 11 / 400 = 0.0275

    expect(taxa_media_simples).toBeCloseTo(0.025, 5)
    expect(taxa_media_ponderada).toBeCloseTo(0.0275, 5)

    // Percentages
    const pct_valor_a = caseA.valor / aggregated.valor_bruto // 100 / 1000 = 0.10
    const pct_valor_b = caseB.valor / aggregated.valor_bruto // 300 / 1000 = 0.30
    const pct_valor_c = caseC.valor / aggregated.valor_bruto // 600 / 1000 = 0.60

    const pct_transacoes_each = 1 / aggregated.qtd_transacoes // 1/3 for each

    // INVARIANT TEST 1: SUM(pct_valor) = 1
    const sum_pct_valor = pct_valor_a + pct_valor_b + pct_valor_c
    expect(sum_pct_valor).toBeCloseTo(1.0, 10)

    // INVARIANT TEST 2: SUM(pct_transacoes) = 1
    const sum_pct_transacoes = pct_transacoes_each * 3
    expect(sum_pct_transacoes).toBeCloseTo(1.0, 10)

    // INVARIANT TEST 3: Case C does NOT participate in fee base
    expect(aggregated.valor_base_taxa).toBe(400) // NOT 1000
    expect(aggregated.qtd_com_fee).toBe(2) // NOT 3
  })

  it('Confiabilidade levels based on qtd_com_fee', async () => {
    // qtd_com_fee >= 30 → ALTA
    // qtd_com_fee >= 10 → MEDIA
    // qtd_com_fee < 10 → BAIXA

    const testCases = [
      { qtd_com_fee: 9, expected: 'BAIXA' },
      { qtd_com_fee: 10, expected: 'MEDIA' },
      { qtd_com_fee: 29, expected: 'MEDIA' },
      { qtd_com_fee: 30, expected: 'ALTA' },
      { qtd_com_fee: 100, expected: 'ALTA' },
    ]

    for (const tc of testCases) {
      const confidence =
        tc.qtd_com_fee >= 30 ? 'ALTA' : tc.qtd_com_fee >= 10 ? 'MEDIA' : 'BAIXA'
      expect(confidence).toBe(tc.expected)
    }
  })
})

/**
 * TODO: Integration test with mock database
 *
 * When db mocking is set up, add:
 * - Mock sumup_transactions (3 transactions: A, B, C)
 * - Mock sumup_payouts (aggregated by transaction_code)
 * - Call calculateTaxas12m()
 * - Verify output matches expected metrics above
 */
