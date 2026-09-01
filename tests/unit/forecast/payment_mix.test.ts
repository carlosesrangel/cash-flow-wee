import { describe, it, expect } from 'vitest'
import { calculatePaymentMix, distributeAcrossModalities } from '@/lib/forecast/payment_mix'
import { createMockSupabaseClient } from '../../mocks/supabase'

/**
 * Golden Dataset 06: Payment Mix - REAL FUNCTION EXECUTION
 * MANDATORY: Tests MUST call calculatePaymentMix() with actual mocked modality data
 */

describe('Payment Mix - GD06', () => {
  it('Single modality 100% PIX', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [
        {
          org_id: 'org1',
          payment_type: 'PIX',
          card_type: 'NAO_INFORMADO',
          nro_parcelas: 1,
          entry_mode: 'NAO_INFORMADO',
          payout_plan: 'NAO_INFORMADO',
          percent_valor_12m: 100,
          valor_total_12m: 50000,
          qtd_transacoes_12m: 250,
        },
      ],
    })

    const result = await calculatePaymentMix(mockAdmin, 'org1')

    expect(result.modalities).toHaveLength(1)
    expect(result.modalities[0].participacao_historica).toBe(1.0)
    expect(result.modalities[0].payment_type).toBe('PIX')
  })

  it('Two modalities: 70% CARD, 30% PIX', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          percent_valor_12m: 70,
          valor_total_12m: 35000,
          qtd_transacoes_12m: 1400,
        },
        {
          org_id: 'org1',
          payment_type: 'PIX',
          card_type: 'NAO_INFORMADO',
          nro_parcelas: 1,
          entry_mode: 'NAO_INFORMADO',
          payout_plan: 'NAO_INFORMADO',
          percent_valor_12m: 30,
          valor_total_12m: 15000,
          qtd_transacoes_12m: 150,
        },
      ],
    })

    const result = await calculatePaymentMix(mockAdmin, 'org1')

    expect(result.modalities).toHaveLength(2)
    const sumPct = result.modalities.reduce((s, m) => s + m.participacao_historica, 0)
    expect(sumPct).toBeCloseTo(1.0, 4)
  })

  it('Three modalities with residual allocation', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          percent_valor_12m: 33.33,
          valor_total_12m: 10000,
          qtd_transacoes_12m: 500,
        },
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'DEBIT',
          nro_parcelas: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          percent_valor_12m: 33.33,
          valor_total_12m: 10000,
          qtd_transacoes_12m: 500,
        },
        {
          org_id: 'org1',
          payment_type: 'PIX',
          card_type: 'NAO_INFORMADO',
          nro_parcelas: 1,
          entry_mode: 'NAO_INFORMADO',
          payout_plan: 'NAO_INFORMADO',
          percent_valor_12m: 33.34,
          valor_total_12m: 10000,
          qtd_transacoes_12m: 500,
        },
      ],
    })

    const result = await calculatePaymentMix(mockAdmin, 'org1')

    expect(result.modalities).toHaveLength(3)
    const sumPct = result.modalities.reduce((s, m) => s + m.participacao_historica, 0)
    expect(sumPct).toBeCloseTo(1.0, 4)
  })

  it('distributeAcrossModalities: 1000 split 70/30', () => {
    const mix = {
      modalities: [
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          participacao_historica: 0.7,
          valor_12m: 35000,
        },
        {
          payment_type: 'PIX',
          card_type: 'NAO_INFORMADO',
          nro_parcelas: 1,
          entry_mode: 'NAO_INFORMADO',
          payout_plan: 'NAO_INFORMADO',
          participacao_historica: 0.3,
          valor_12m: 15000,
        },
      ],
      total_valor_12m: 50000,
    }

    const distributed = distributeAcrossModalities(1000, mix)

    expect(distributed).toHaveLength(2)
    expect(distributed[0].amount).toBeCloseTo(700, 2)
    expect(distributed[1].amount).toBeCloseTo(300, 2)
    const sumAmount = distributed.reduce((s, d) => s + d.amount, 0)
    expect(sumAmount).toBeCloseTo(1000, 2)
  })

  it('Integer cents conservation: 1000 centsunits split exactly', () => {
    const mix = {
      modalities: [
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          participacao_historica: 0.333,
          valor_12m: 16650,
        },
        {
          payment_type: 'CARD',
          card_type: 'DEBIT',
          nro_parcelas: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          participacao_historica: 0.333,
          valor_12m: 16650,
        },
        {
          payment_type: 'PIX',
          card_type: 'NAO_INFORMADO',
          nro_parcelas: 1,
          entry_mode: 'NAO_INFORMADO',
          payout_plan: 'NAO_INFORMADO',
          participacao_historica: 0.334,
          valor_12m: 16700,
        },
      ],
      total_valor_12m: 50000,
    }

    const distributed = distributeAcrossModalities(1000, mix)

    const sumAmount = distributed.reduce((s, d) => s + d.amount, 0)
    expect(sumAmount).toBeCloseTo(1000, 0) // Exactly 100000 cents
  })

  it('Empty mix returns empty distribution', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [],
    })

    const result = await calculatePaymentMix(mockAdmin, 'org1')

    expect(result.modalities).toEqual([])
  })

  it('Filters out zero-percent entries', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          percent_valor_12m: 100,
          valor_total_12m: 50000,
          qtd_transacoes_12m: 500,
        },
        {
          org_id: 'org1',
          payment_type: 'UNKNOWN',
          card_type: 'UNKNOWN',
          nro_parcelas: 1,
          entry_mode: 'UNKNOWN',
          payout_plan: 'UNKNOWN',
          percent_valor_12m: 0,
          valor_total_12m: 0,
          qtd_transacoes_12m: 0,
        },
      ],
    })

    const result = await calculatePaymentMix(mockAdmin, 'org1')

    expect(result.modalities).toHaveLength(1)
    expect(result.modalities[0].payment_type).toBe('CARD')
  })
})
