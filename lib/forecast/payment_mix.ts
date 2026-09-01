/**
 * Payment Mix Engine: Distribute Seasonality Band across Modalities
 *
 * Takes a band revenue and distributes it across modalities
 * based on historical participation rates from the last 12 months.
 *
 * Invariant: SUM(Receita Projetada Modalidade per band) = Receita Projetada Faixa
 *
 * Power Query specification: Payment Mix calculation (implied in pipeline flow)
 */

import { SupabaseClient } from '@supabase/supabase-js'

export interface ModalityMix {
  payment_type: string
  card_type: string
  nro_parcelas: number
  entry_mode: string
  payout_plan: string
  participacao_historica: number // historical participation, SUM = 1.0
  valor_12m: number // 12M historical value
}

export interface PaymentMixResult {
  modalities: ModalityMix[]
  total_valor_12m: number
}

/**
 * Calculate payment mix based on 12-month historical data
 * Returns modality participation rates
 */
export async function calculatePaymentMix(
  admin: SupabaseClient,
  orgId: string
): Promise<PaymentMixResult> {
  // Load 12-month fee rates
  const { data: feeRates, error } = await admin
    .from('sumup_fee_rates_12m')
    .select(
      'payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan, valor_base_taxa_12m, percent_valor_12m'
    )
    .eq('org_id', orgId)

  if (error) throw new Error(`Failed to load fee rates: ${error.message}`)

  // Filter to valid rows: percent_valor_12m > 0
  const validRows = (feeRates || []).filter((row) => (row.percent_valor_12m || 0) > 0)

  if (validRows.length === 0) {
    return {
      modalities: [],
      total_valor_12m: 0,
    }
  }

  // Calculate total
  const totalValor = validRows.reduce((sum, row) => sum + (row.percent_valor_12m || 0), 0)

  // Calculate participation for each modality
  const modalities: ModalityMix[] = validRows.map((row) => ({
    payment_type: row.payment_type,
    card_type: row.card_type,
    nro_parcelas: row.nro_parcelas_modelo,
    entry_mode: row.entry_mode,
    payout_plan: row.payout_plan,
    participacao_historica: totalValor > 0 ? (row.percent_valor_12m || 0) / totalValor : 0,
    valor_12m: row.percent_valor_12m || 0,
  }))

  return {
    modalities,
    total_valor_12m: totalValor,
  }
}

/**
 * Distribute a band's revenue across modalities
 * @param bandAmount revenue to distribute
 * @param mix payment mix from calculatePaymentMix
 * @returns array of modality amounts
 */
export function distributeAcrossModalities(
  bandAmount: number,
  mix: PaymentMixResult
): Array<{
  payment_type: string
  card_type: string
  nro_parcelas: number
  entry_mode: string
  payout_plan: string
  amount: number
}> {
  return mix.modalities.map((modality) => ({
    payment_type: modality.payment_type,
    card_type: modality.card_type,
    nro_parcelas: modality.nro_parcelas,
    entry_mode: modality.entry_mode,
    payout_plan: modality.payout_plan,
    amount: Math.round(bandAmount * modality.participacao_historica * 100) / 100, // 2 decimals
  }))
}

/**
 * Validate payment mix invariant
 * SUM(amount) should = bandAmount
 */
export function validatePaymentMixInvariant(
  bandAmount: number,
  distributed: Array<{ amount: number }>
): boolean {
  const sum = distributed.reduce((total, item) => total + item.amount, 0)
  return Math.abs(sum - bandAmount) < 0.01 // allow 1 cent rounding error
}
