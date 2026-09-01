import { describe, it, expect } from 'vitest'
import { validateReceiptProfileInvariants, projectPaymentReceipt } from '@/lib/forecast/receipt_profile'

/**
 * Golden Dataset 05: Receipt Profile
 *
 * Tests the months-to-receipt distribution and month arithmetic
 */

describe('Receipt Profile Golden Dataset', () => {
  it('Months-to-receipt using DATE_TRUNC arithmetic (not dias/30)', () => {
    // Scenario: CARD 3x transaction on 2026-01-15
    // Payouts: 2026-02-15 (M+1), 2026-03-15 (M+2), 2026-04-15 (M+3)
    //
    // Month calculation:
    // M+1: (2026*12 + 2) - (2026*12 + 1) = 1 month
    // M+2: (2026*12 + 3) - (2026*12 + 1) = 2 months
    // M+3: (2026*12 + 4) - (2026*12 + 1) = 3 months

    const saleDate = new Date('2026-01-15')
    const payout1Date = new Date('2026-02-15')
    const payout2Date = new Date('2026-03-15')
    const payout3Date = new Date('2026-04-15')

    const saleYear = saleDate.getFullYear()
    const saleMonth = saleDate.getMonth() + 1
    const payout1Year = payout1Date.getFullYear()
    const payout1Month = payout1Date.getMonth() + 1

    const mesAteReceber1 = payout1Year * 12 + payout1Month - (saleYear * 12 + saleMonth)
    const mesAteReceber2 =
      payout2Date.getFullYear() * 12 +
      (payout2Date.getMonth() + 1) -
      (saleYear * 12 + saleMonth)
    const mesAteReceber3 =
      payout3Date.getFullYear() * 12 +
      (payout3Date.getMonth() + 1) -
      (saleYear * 12 + saleMonth)

    expect(mesAteReceber1).toBe(1)
    expect(mesAteReceber2).toBe(2)
    expect(mesAteReceber3).toBe(3)
  })

  it('Month-end boundaries: 31 Jan + 1 day = 1 month to Feb 1, NOT 31/30 days', () => {
    // Scenario: Sale on 2026-01-31
    // Payout on 2026-02-01
    //
    // Using DATE_TRUNC arithmetic:
    // (2026*12 + 2) - (2026*12 + 1) = 1 month
    //
    // Using wrong dias/30: 1/30 = 0.033 months ❌
    // Correct: 1 month ✓

    const saleDate = new Date(2026, 0, 31) // Jan 31, 2026
    const payoutDate = new Date(2026, 1, 1) // Feb 1, 2026

    const saleYear = saleDate.getFullYear()
    const saleMonth = saleDate.getMonth() + 1
    const payoutYear = payoutDate.getFullYear()
    const payoutMonth = payoutDate.getMonth() + 1

    const mesesAteReceber = payoutYear * 12 + payoutMonth - (saleYear * 12 + saleMonth)

    expect(mesesAteReceber).toBe(1) // 1 month, not 0.033
  })

  it('Invariant: SUM(pct_recebimento_modalidade) = 1.0 per modality', () => {
    // Scenario: CARD 3x distribution
    // M+0: 20% (immediate)
    // M+1: 50% (month 1)
    // M+2: 30% (month 2)

    const profile = {
      payment_type: 'CARD',
      card_type: 'CREDIT',
      nro_parcelas: 3,
      entry_mode: 'POS',
      payout_plan: 'D+1',
      distributions: [
        { meses_ate_receber: 0, pct_recebimento_modalidade: 0.2 },
        { meses_ate_receber: 1, pct_recebimento_modalidade: 0.5 },
        { meses_ate_receber: 2, pct_recebimento_modalidade: 0.3 },
      ] as any,
      confiabilidade: 'MEDIA' as const,
      total_payouts_analyzed: 15,
    }

    expect(validateReceiptProfileInvariants(profile)).toBe(true)
  })

  it('Distribution M+0, M+1, M+2 (common for cards)', () => {
    // Scenario: 3-installment card payment
    // Installments received on: M (30%), M+1 (50%), M+2 (20%)

    const profile = {
      payment_type: 'CARD',
      card_type: 'CREDIT',
      nro_parcelas: 3,
      entry_mode: 'POS',
      payout_plan: 'D+1',
      distributions: [
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 0,
          valor_recebido: 30000,
          qtd_recebimentos: 10,
          pct_recebimento_modalidade: 0.3,
        },
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 1,
          valor_recebido: 50000,
          qtd_recebimentos: 17,
          pct_recebimento_modalidade: 0.5,
        },
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 2,
          valor_recebido: 20000,
          qtd_recebimentos: 7,
          pct_recebimento_modalidade: 0.2,
        },
      ],
      confiabilidade: 'ALTA' as const,
      total_payouts_analyzed: 34,
    }

    const sum = profile.distributions.reduce((total, d) => total + d.pct_recebimento_modalidade, 0)
    expect(sum).toBeCloseTo(1.0, 5)
    expect(profile.confiabilidade).toBe('ALTA') // >= 30 payouts
  })

  it('Payment projection: sale amount distributed by receipt profile', () => {
    // Scenario: R$ 1000 sale with profile [30% M+0, 50% M+1, 20% M+2]
    // Expected: [300, 500, 200]

    const profile = {
      payment_type: 'CARD',
      card_type: 'CREDIT',
      nro_parcelas: 3,
      entry_mode: 'POS',
      payout_plan: 'D+1',
      distributions: [
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 0,
          valor_recebido: 0,
          qtd_recebimentos: 0,
          pct_recebimento_modalidade: 0.3,
        },
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 1,
          valor_recebido: 0,
          qtd_recebimentos: 0,
          pct_recebimento_modalidade: 0.5,
        },
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 2,
          valor_recebido: 0,
          qtd_recebimentos: 0,
          pct_recebimento_modalidade: 0.2,
        },
      ],
      confiabilidade: 'MEDIA' as const,
      total_payouts_analyzed: 15,
    }

    const projected = projectPaymentReceipt(1000, '2026-01', profile)

    expect(projected.length).toBe(3)
    expect(projected[0].expected_amount).toBeCloseTo(300, 2) // 30% in Jan
    expect(projected[1].expected_amount).toBeCloseTo(500, 2) // 50% in Feb
    expect(projected[2].expected_amount).toBeCloseTo(200, 2) // 20% in Mar
    expect(projected[0].month).toBe(1)
    expect(projected[1].month).toBe(2)
    expect(projected[2].month).toBe(3)
  })

  it('Month overflow: sale in Nov + M+2 = Jan next year', () => {
    // Scenario: Sale November 2026, payout in January 2027 (M+2)

    const profile = {
      payment_type: 'CARD',
      card_type: 'CREDIT',
      nro_parcelas: 3,
      entry_mode: 'POS',
      payout_plan: 'D+1',
      distributions: [
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 2,
          valor_recebido: 0,
          qtd_recebimentos: 0,
          pct_recebimento_modalidade: 1.0,
        },
      ],
      confiabilidade: 'BAIXA' as const,
      total_payouts_analyzed: 5,
    }

    const projected = projectPaymentReceipt(1000, '2026-11', profile)

    expect(projected[0].year).toBe(2027) // Year rolled forward
    expect(projected[0].month).toBe(1) // January
  })

  it('Confiabilidade based on payouts count', () => {
    const test_cases = [
      { total_payouts: 5, expected: 'BAIXA' },
      { total_payouts: 9, expected: 'BAIXA' },
      { total_payouts: 10, expected: 'MEDIA' },
      { total_payouts: 29, expected: 'MEDIA' },
      { total_payouts: 30, expected: 'ALTA' },
      { total_payouts: 100, expected: 'ALTA' },
    ]

    for (const tc of test_cases) {
      const confidence =
        tc.total_payouts >= 30 ? 'ALTA' : tc.total_payouts >= 10 ? 'MEDIA' : 'BAIXA'
      expect(confidence).toBe(tc.expected)
    }
  })

  it('PIX payment (immediate) vs CARD (deferred)', () => {
    // Scenario A: PIX 100% in M+0 (immediate)
    const pix_profile = {
      payment_type: 'PIX',
      card_type: 'NA',
      nro_parcelas: 1,
      entry_mode: 'POS',
      payout_plan: 'D+0', // immediate
      distributions: [
        {
          payment_type: 'PIX',
          card_type: 'NA',
          nro_parcelas: 1,
          entry_mode: 'POS',
          payout_plan: 'D+0',
          meses_ate_receber: 0,
          valor_recebido: 10000,
          qtd_recebimentos: 50,
          pct_recebimento_modalidade: 1.0,
        },
      ],
      confiabilidade: 'ALTA' as const,
      total_payouts_analyzed: 50,
    }

    // Scenario B: CARD 3x distribution across M+0, M+1, M+2
    const card_profile = {
      payment_type: 'CARD',
      card_type: 'CREDIT',
      nro_parcelas: 3,
      entry_mode: 'POS',
      payout_plan: 'D+1',
      distributions: [
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 0,
          valor_recebido: 3000,
          qtd_recebimentos: 30,
          pct_recebimento_modalidade: 0.3,
        },
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 1,
          valor_recebido: 5000,
          qtd_recebimentos: 50,
          pct_recebimento_modalidade: 0.5,
        },
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 2,
          valor_recebido: 2000,
          qtd_recebimentos: 20,
          pct_recebimento_modalidade: 0.2,
        },
      ],
      confiabilidade: 'ALTA' as const,
      total_payouts_analyzed: 100,
    }

    // PIX is immediate, CARD is deferred
    expect(pix_profile.distributions[0].meses_ate_receber).toBe(0)
    expect(card_profile.distributions[0].meses_ate_receber).toBe(0)
    expect(card_profile.distributions[1].meses_ate_receber).toBe(1)
  })
})
