/**
 * Fee Fallback Lookup: 4-Tier Hierarchy
 *
 * When calculating forecast fees, fallback tiers are used in order:
 * 1. Exact match (5D: payment_type + card_type + nro_parcelas + entry_mode + payout_plan)
 * 2. 3D aggregation (payment_type + nro_parcelas, across card/entry/payout)
 * 3. 1D aggregation (payment_type only)
 * 4. Global rate (all payment types)
 *
 * Each tier requires >= 5 transactions with fee data (qtd_com_fee >= 5)
 * to be considered reliable.
 *
 * Power Query specification: Point 6
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { FeeRateMetrics } from './taxas_12m'

interface FeeRateLookupResult {
  taxa: number | null
  tier: 'EXACT_MATCH' | '3D_AGGREGATION' | '1D_AGGREGATION' | 'GLOBAL' | 'NOT_FOUND'
  qtd_com_fee: number
  valor_base_taxa: number
  fee_total: number
  confiabilidade: 'ALTA' | 'MEDIA' | 'BAIXA'
}

/**
 * Lookup fee rate for a specific transaction modality
 *
 * Tries 4 tiers in order; returns first match with qtd_com_fee >= 5
 */
export async function lookupFeeRate(
  admin: SupabaseClient,
  orgId: string,
  payment_type: string,
  card_type: string,
  nro_parcelas: number,
  entry_mode: string,
  payout_plan: string
): Promise<FeeRateLookupResult> {
  // Tier 1: Exact Match (5D)
  const tier1 = await admin
    .from('sumup_fee_rates_12m')
    .select('taxa_media_ponderada, qtd_com_fee, valor_base_taxa_12m, fee_total_12m, confiabilidade')
    .eq('org_id', orgId)
    .eq('payment_type', payment_type)
    .eq('card_type', card_type)
    .eq('nro_parcelas_modelo', nro_parcelas)
    .eq('entry_mode', entry_mode)
    .eq('payout_plan', payout_plan)
    .single()

  if (tier1.data && tier1.data.qtd_com_fee >= 5) {
    return {
      taxa: tier1.data.taxa_media_ponderada,
      tier: 'EXACT_MATCH',
      qtd_com_fee: tier1.data.qtd_com_fee,
      valor_base_taxa: tier1.data.valor_base_taxa_12m,
      fee_total: tier1.data.fee_total_12m,
      confiabilidade: tier1.data.confiabilidade,
    }
  }

  // Tier 2: 3D Aggregation (payment_type + nro_parcelas)
  // Group by these 2D, aggregate fee/valor across card_type, entry_mode, payout_plan
  const tier2 = await admin
    .from('sumup_fee_rates_12m')
    .select('qtd_com_fee, valor_base_taxa_12m, fee_total_12m, confiabilidade', {
      count: 'exact',
    })
    .eq('org_id', orgId)
    .eq('payment_type', payment_type)
    .eq('nro_parcelas_modelo', nro_parcelas)

  if (tier2.data && tier2.data.length > 0) {
    const aggregated = tier2.data.reduce(
      (acc, row) => ({
        qtd_com_fee: acc.qtd_com_fee + row.qtd_com_fee,
        valor_base_taxa_12m: acc.valor_base_taxa_12m + row.valor_base_taxa_12m,
        fee_total_12m: acc.fee_total_12m + row.fee_total_12m,
      }),
      { qtd_com_fee: 0, valor_base_taxa_12m: 0, fee_total_12m: 0 }
    )

    if (aggregated.qtd_com_fee >= 5 && aggregated.valor_base_taxa_12m > 0) {
      const taxa = aggregated.fee_total_12m / aggregated.valor_base_taxa_12m
      const confiabilidade =
        aggregated.qtd_com_fee >= 30 ? 'ALTA' : aggregated.qtd_com_fee >= 10 ? 'MEDIA' : 'BAIXA'

      return {
        taxa,
        tier: '3D_AGGREGATION',
        qtd_com_fee: aggregated.qtd_com_fee,
        valor_base_taxa: aggregated.valor_base_taxa_12m,
        fee_total: aggregated.fee_total_12m,
        confiabilidade,
      }
    }
  }

  // Tier 3: 1D Aggregation (payment_type only)
  const tier3 = await admin
    .from('sumup_fee_rates_12m')
    .select('qtd_com_fee, valor_base_taxa_12m, fee_total_12m', { count: 'exact' })
    .eq('org_id', orgId)
    .eq('payment_type', payment_type)

  if (tier3.data && tier3.data.length > 0) {
    const aggregated = tier3.data.reduce(
      (acc, row) => ({
        qtd_com_fee: acc.qtd_com_fee + row.qtd_com_fee,
        valor_base_taxa_12m: acc.valor_base_taxa_12m + row.valor_base_taxa_12m,
        fee_total_12m: acc.fee_total_12m + row.fee_total_12m,
      }),
      { qtd_com_fee: 0, valor_base_taxa_12m: 0, fee_total_12m: 0 }
    )

    if (aggregated.qtd_com_fee >= 5 && aggregated.valor_base_taxa_12m > 0) {
      const taxa = aggregated.fee_total_12m / aggregated.valor_base_taxa_12m
      const confiabilidade =
        aggregated.qtd_com_fee >= 30 ? 'ALTA' : aggregated.qtd_com_fee >= 10 ? 'MEDIA' : 'BAIXA'

      return {
        taxa,
        tier: '1D_AGGREGATION',
        qtd_com_fee: aggregated.qtd_com_fee,
        valor_base_taxa: aggregated.valor_base_taxa_12m,
        fee_total: aggregated.fee_total_12m,
        confiabilidade,
      }
    }
  }

  // Tier 4: Global Rate (all payment types)
  const tier4 = await admin
    .from('sumup_fee_rates_12m')
    .select('qtd_com_fee, valor_base_taxa_12m, fee_total_12m')
    .eq('org_id', orgId)

  if (tier4.data && tier4.data.length > 0) {
    const aggregated = tier4.data.reduce(
      (acc, row) => ({
        qtd_com_fee: acc.qtd_com_fee + row.qtd_com_fee,
        valor_base_taxa_12m: acc.valor_base_taxa_12m + row.valor_base_taxa_12m,
        fee_total_12m: acc.fee_total_12m + row.fee_total_12m,
      }),
      { qtd_com_fee: 0, valor_base_taxa_12m: 0, fee_total_12m: 0 }
    )

    if (aggregated.valor_base_taxa_12m > 0) {
      const taxa = aggregated.fee_total_12m / aggregated.valor_base_taxa_12m
      const confiabilidade =
        aggregated.qtd_com_fee >= 30 ? 'ALTA' : aggregated.qtd_com_fee >= 10 ? 'MEDIA' : 'BAIXA'

      return {
        taxa,
        tier: 'GLOBAL',
        qtd_com_fee: aggregated.qtd_com_fee,
        valor_base_taxa: aggregated.valor_base_taxa_12m,
        fee_total: aggregated.fee_total_12m,
        confiabilidade,
      }
    }
  }

  // Not found
  return {
    taxa: null,
    tier: 'NOT_FOUND',
    qtd_com_fee: 0,
    valor_base_taxa: 0,
    fee_total: 0,
    confiabilidade: 'BAIXA',
  }
}

/**
 * Lookup fee rate for projected sales (simpler rule than lookupFeeRate)
 * Used for forecasting, not actual transactions
 *
 * Tiers:
 * 1. Exact match (5D) if available and valid
 * 2. payment_type + nro_parcelas aggregation
 * 3. No match: taxa = null (the source is unavailable; callers may choose a
 * conservative projection policy, but must keep the missing-source status).
 */
export async function lookupProjectedSaleFeeRate(
  admin: SupabaseClient,
  orgId: string,
  payment_type: string,
  card_type: string,
  nro_parcelas: number,
  entry_mode: string,
  payout_plan: string
): Promise<{ taxa: number | null; source: 'COMBINACAO_EXATA' | 'MODALIDADE_E_PARCELAS' | 'SEM_TAXA_HISTORICA' }> {
  // Tier 1: Exact Match (5D)
  const tier1 = await admin
    .from('sumup_fee_rates_12m')
    .select('taxa_media_ponderada, valor_base_taxa_12m')
    .eq('org_id', orgId)
    .eq('payment_type', payment_type)
    .eq('card_type', card_type)
    .eq('nro_parcelas_modelo', nro_parcelas)
    .eq('entry_mode', entry_mode)
    .eq('payout_plan', payout_plan)
    .single()

  if (tier1.data && tier1.data.taxa_media_ponderada !== null && tier1.data.valor_base_taxa_12m > 0) {
    return {
      taxa: tier1.data.taxa_media_ponderada,
      source: 'COMBINACAO_EXATA',
    }
  }

  // Tier 2: payment_type + nro_parcelas aggregation
  const tier2 = await admin
    .from('sumup_fee_rates_12m')
    .select('valor_base_taxa_12m, fee_total_12m')
    .eq('org_id', orgId)
    .eq('payment_type', payment_type)
    .eq('nro_parcelas_modelo', nro_parcelas)

  if (tier2.data && tier2.data.length > 0) {
    const aggregated = tier2.data.reduce(
      (acc, row) => ({
        valor_base_taxa_12m: acc.valor_base_taxa_12m + (row.valor_base_taxa_12m || 0),
        fee_total_12m: acc.fee_total_12m + (row.fee_total_12m || 0),
      }),
      { valor_base_taxa_12m: 0, fee_total_12m: 0 }
    )

    if (aggregated.valor_base_taxa_12m > 0) {
      const taxa = aggregated.fee_total_12m / aggregated.valor_base_taxa_12m
      return {
        taxa,
        source: 'MODALIDADE_E_PARCELAS',
      }
    }
  }

  // No match is not evidence of a zero fee. Keep the value unknown so the
  // forecast can expose FEE_VALUE_PARITY as blocked by source data.
  return {
    taxa: null,
    source: 'SEM_TAXA_HISTORICA',
  }
}

/**
 * Batch lookup for multiple transactions
 * Useful for forecast population
 */
export async function batchLookupFeeRates(
  admin: SupabaseClient,
  orgId: string,
  transactions: Array<{
    id: string
    payment_type: string
    card_type: string
    nro_parcelas: number
    entry_mode: string
    payout_plan: string
  }>
): Promise<Map<string, FeeRateLookupResult>> {
  const results = new Map<string, FeeRateLookupResult>()

  for (const tx of transactions) {
    const result = await lookupFeeRate(
      admin,
      orgId,
      tx.payment_type,
      tx.card_type,
      tx.nro_parcelas,
      tx.entry_mode,
      tx.payout_plan
    )
    results.set(tx.id, result)
  }

  return results
}
