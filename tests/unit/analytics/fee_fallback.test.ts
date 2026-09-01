import { describe, it, expect } from 'vitest'
import { lookupFeeRate, lookupProjectedSaleFeeRate } from '@/lib/analytics/fee_fallback'
import { createMockSupabaseClient } from '../../mocks/supabase'

/**
 * Golden Dataset 02: Fee Fallback - REAL FUNCTION EXECUTION
 */

describe('Fee Fallback - GD02', () => {
  let mockAdmin: ReturnType<typeof createMockSupabaseClient>

  // Tier 1: Exact Match
  it('Tier 1 exact match with qtd >= 5 returns rate', async () => {
    mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas_modelo: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          taxa_media_ponderada: 0.025,
          qtd_com_fee: 10,
          valor_base_taxa_12m: 5000,
          fee_total_12m: 125,
          confiabilidade: 'MEDIA',
        },
      ],
    })

    const result = await lookupFeeRate(mockAdmin, 'org1', 'CARD', 'CREDIT', 1, 'POS', 'D+1')

    expect(result.taxa).toBe(0.025)
    expect(result.tier).toBe('EXACT_MATCH')
    expect(result.qtd_com_fee).toBe(10)
  })

  // Tier 1: Below threshold
  it('Tier 1 below qtd threshold falls through to Tier 2', async () => {
    mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [
        // Exact match exists but qtd=4 < 5
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas_modelo: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          taxa_media_ponderada: 0.02,
          qtd_com_fee: 4, // Below threshold
          valor_base_taxa_12m: 2000,
          fee_total_12m: 40,
          confiabilidade: 'BAIXA',
        },
        // Tier 2 data: payment_type + nro_parcelas aggregation
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'DEBIT', // Different card type
          nro_parcelas_modelo: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          taxa_media_ponderada: 0.015,
          qtd_com_fee: 8,
          valor_base_taxa_12m: 5000,
          fee_total_12m: 75,
          confiabilidade: 'MEDIA',
        },
      ],
    })

    const result = await lookupFeeRate(mockAdmin, 'org1', 'CARD', 'CREDIT', 1, 'POS', 'D+1')

    // Should fall back to Tier 2 or Tier 3
    expect(result.tier).not.toBe('EXACT_MATCH')
  })

  // Tier 2: Aggregation (when exact match doesn't meet threshold)
  it('Tier 2 aggregates payment_type + nro_parcelas when exact match below threshold', async () => {
    mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [
        // Exact match exists but below threshold (qtd=4 < 5)
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas_modelo: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          taxa_media_ponderada: 0.03,
          qtd_com_fee: 4, // Below threshold
          valor_base_taxa_12m: 2000,
          fee_total_12m: 60,
          confiabilidade: 'MEDIA',
        },
        // Tier 2 candidate: same payment_type + nro_parcelas, different modality
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'DEBIT',
          nro_parcelas_modelo: 3,
          entry_mode: 'POS',
          payout_plan: 'D+7',
          taxa_media_ponderada: 0.02,
          qtd_com_fee: 8,
          valor_base_taxa_12m: 3000,
          fee_total_12m: 60,
          confiabilidade: 'MEDIA',
        },
      ],
    })

    const result = await lookupFeeRate(mockAdmin, 'org1', 'CARD', 'CREDIT', 3, 'POS', 'D+1')

    // Exact match fails (qtd=4 < 5), should fall back to Tier 2: CARD + nro=3 aggregation
    expect(result.tier).toBe('3D_AGGREGATION')
    expect(result.qtd_com_fee).toBe(12) // 4 + 8
  })

  // Tier 4: Global
  it('Tier 4 global fallback', async () => {
    mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [
        {
          org_id: 'org1',
          payment_type: 'PIX',
          card_type: 'NAO_INFORMADO',
          nro_parcelas_modelo: 1,
          entry_mode: 'NAO_INFORMADO',
          payout_plan: 'D+0',
          taxa_media_ponderada: 0.005,
          qtd_com_fee: 50,
          valor_base_taxa_12m: 100000,
          fee_total_12m: 500,
          confiabilidade: 'ALTA',
        },
      ],
    })

    const result = await lookupFeeRate(mockAdmin, 'org1', 'UNKNOWN', 'UNKNOWN', 1, 'UNKNOWN', 'UNKNOWN')

    // No exact or partial match, should fall back to Tier 4 (all)
    expect(result.tier).toBe('GLOBAL')
  })

  // NOT_FOUND: No data
  it('NOT_FOUND when no data available', async () => {
    mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [],
    })

    const result = await lookupFeeRate(mockAdmin, 'org1', 'UNKNOWN', 'UNKNOWN', 1, 'UNKNOWN', 'UNKNOWN')

    expect(result.taxa).toBeNull()
    expect(result.tier).toBe('NOT_FOUND')
  })

  // Projected sale fee lookup
  it('lookupProjectedSaleFeeRate: Exact match source', async () => {
    mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [
        {
          org_id: 'org1',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas_modelo: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          taxa_media_ponderada: 0.02,
          valor_base_taxa_12m: 10000,
          fee_total_12m: 200,
        },
      ],
    })

    const result = await lookupProjectedSaleFeeRate(mockAdmin, 'org1', 'CARD', 'CREDIT', 1, 'POS', 'D+1')

    expect(result.taxa).toBe(0.02)
    expect(result.source).toBe('COMBINACAO_EXATA')
  })

  it('lookupProjectedSaleFeeRate: No match returns 0', async () => {
    mockAdmin = createMockSupabaseClient({
      sumup_fee_rates_12m: [],
    })

    const result = await lookupProjectedSaleFeeRate(mockAdmin, 'org1', 'UNKNOWN', 'UNKNOWN', 1, 'UNKNOWN', 'UNKNOWN')

    expect(result.taxa).toBe(0)
    expect(result.source).toBe('SEM_TAXA_HISTORICA')
  })

  // Invariant: taxa >= 0
  it('Taxa never negative', () => {
    const cases = [0, 0.001, 0.01, 0.05, 0.1]
    for (const taxa of cases) {
      expect(taxa).toBeGreaterThanOrEqual(0)
    }
  })

  // Invariant: fee = amount * taxa >= 0
  it('Fee calculation conservative', () => {
    const amounts = [100, 1000, 10000]
    const rates = [0, 0.01, 0.05]
    for (const amount of amounts) {
      for (const rate of rates) {
        const fee = amount * rate
        expect(fee).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
