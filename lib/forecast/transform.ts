/**
 * Financial Model V2: Forecast to Receipts Transformation
 *
 * CRITICAL SPECIFICATION:
 * Forecast de Receita != Entrada de Caixa
 *
 * Pipeline:
 * Receita Mensal Projetada
 *   → Sazonalidade (3-band distribution within month)
 *   → Mix Histórico (payment type distribution)
 *   → Taxas Históricas (fee by modality)
 *   → Perfil Recebimento (timing distribution by modality)
 *   → Entrada Futura Líquida (net cash receipts)
 *
 * This is NOT forecast on revenue, this is forecast on RECEIPTS.
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { applySeasonalityToMonth, getDateForBand, type SeasonalityFactor } from '@/lib/seasonality/calculate'
import { getFeeRateFallback } from '@/lib/fees/calculate'
import { applyReceiptProfile, validateReceiptProfileInvariant } from '@/lib/receipt-profile/calculate'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type PaymentModality = {
  payment_type: string
  card_type: string
  nro_parcelas_modelo: number
  entry_mode: string
  payout_plan: string
  participacao_historica: number
  taxa_utilizada: number
  fonte_taxa: 'COMBINACAO_EXATA' | 'MODALIDADE_E_PARCELAS' | 'MODALIDADE' | 'TAXA_GLOBAL' | 'SEM_TAXA_HISTORICA'
}

export type ProjectedReceipt = {
  data_venda: Date
  data_recebimento: Date
  meses_ate_receber: number
  modalidade: string
  payment_type: string
  card_type: string
  nro_parcelas_modelo: number
  entry_mode: string
  payout_plan: string
  receita_projetada_bruta: number
  fee_projetado: number
  recebimento_liquido_projetado: number
  taxa_projetada_ponderada: number
  fonte_taxa: string
  foi_fallback_receipt_profile: boolean
}

/**
 * Get historical mix of payment types from last 12 months
 * Normalized so SUM(participacao) = 1.0
 */
export async function getPaymentMix(
  admin: AdminClient,
  orgId: string
): Promise<PaymentModality[]> {
  const { data: feeRates, error } = await admin
    .from('sumup_fee_rates_12m')
    .select('*')
    .eq('org_id', orgId)
    .filter('pct_valor_12m', 'gt', 0)

  if (error || !feeRates) {
    return []
  }

  // Normalize participacao
  const totalPct = feeRates.reduce((sum, row) => sum + (row.pct_valor_12m || 0), 0)
  if (totalPct === 0) return []

  return feeRates.map((row) => ({
    payment_type: row.payment_type,
    card_type: row.card_type,
    nro_parcelas_modelo: row.nro_parcelas_modelo,
    entry_mode: row.entry_mode,
    payout_plan: row.payout_plan,
    participacao_historica: (row.pct_valor_12m || 0) / totalPct,
    taxa_utilizada: row.taxa_media_ponderada || 0,
    fonte_taxa: 'COMBINACAO_EXATA', // simplified; in real code use fallback tier
  }))
}

/**
 * Transform a single forecast month into projected receipts
 *
 * Steps:
 * 1. Apply seasonality (3 bands) to get faixa amounts
 * 2. For each band:
 *    a. Cross with each payment modality from mix
 *    b. Calculate fee using fallback tier
 *    c. Apply receipt profile to get timing
 *    d. Create projected receipt entries
 */
export async function transformForecastMonthToReceipts(
  admin: AdminClient,
  orgId: string,
  mes: MonthlyValue, // { ano, mes, value: receita_projetada }
  dataVenda?: Date // explicitly set sale date (for testing), else use first day of month
): Promise<ProjectedReceipt[]> {
  const receipts: ProjectedReceipt[] = []

  // Step 1: Apply seasonality
  const sezonalidade = await applySeasonalityToMonth(admin, orgId, mes.mes, mes.ano, mes.value)

  if (!sezonalidade.invariante_check.valida) {
    console.warn(`Seasonality invariant failed for ${mes.ano}-${mes.mes}`, sezonalidade.invariante_check)
  }

  // Step 2: Get payment mix
  const mix = await getPaymentMix(admin, orgId)
  if (mix.length === 0) {
    console.warn(`No payment mix found for org ${orgId}; using fallback (PIX 100%)`)
    // Fallback: assume PIX 100%
    mix.push({
      payment_type: 'PIX',
      card_type: 'NAO_INFORMADO',
      nro_parcelas_modelo: 1,
      entry_mode: 'NAO_INFORMADO',
      payout_plan: 'NAO_INFORMADO',
      participacao_historica: 1.0,
      taxa_utilizada: 0.01,
      fonte_taxa: 'SEM_TAXA_HISTORICA',
    })
  }

  // Step 3: For each band, cross with each modality
  for (const banda of sezonalidade.bandas) {
    const dataVendaBanda = dataVenda || getDateForBand(mes.ano, mes.mes, banda.faixa)

    for (const modality of mix) {
      const receita_faixa = banda.receita_projetada_faixa
      const receita_modalidade = receita_faixa * modality.participacao_historica

      // Get fee for this modality
      const feeResult = await getFeeRateFallback(
        admin,
        orgId,
        modality.payment_type,
        modality.card_type,
        modality.nro_parcelas_modelo,
        modality.entry_mode,
        modality.payout_plan
      )

      const taxa_utilizada = feeResult.taxaMediaPonderada || 0
      const fee_venda = Math.round(receita_modalidade * taxa_utilizada * 100) / 100

      // Apply receipt profile timing
      const receiptTimings = await applyReceiptProfile(
        admin,
        orgId,
        dataVendaBanda,
        receita_modalidade,
        fee_venda,
        modality.payment_type,
        modality.card_type,
        modality.nro_parcelas_modelo,
        modality.entry_mode,
        modality.payout_plan
      )

      // Create projected receipt entries
      for (const timing of receiptTimings) {
        receipts.push({
          data_venda: timing.data_venda,
          data_recebimento: timing.data_recebimento,
          meses_ate_receber: timing.meses_ate_receber,
          modalidade: `${modality.payment_type}/${modality.nro_parcelas_modelo}x`,
          payment_type: modality.payment_type,
          card_type: modality.card_type,
          nro_parcelas_modelo: modality.nro_parcelas_modelo,
          entry_mode: modality.entry_mode,
          payout_plan: modality.payout_plan,
          receita_projetada_bruta: timing.recebimento_bruto,
          fee_projetado: timing.fee_aplicado,
          recebimento_liquido_projetado: timing.recebimento_liquido,
          taxa_projetada_ponderada: taxa_utilizada,
          fonte_taxa: feeResult.fonte,
          foi_fallback_receipt_profile: timing.foi_fallback,
        })
      }
    }
  }

  return receipts
}

/**
 * Transform multiple forecast months
 */
export async function transformForecastToReceipts(
  admin: AdminClient,
  orgId: string,
  forecast: MonthlyValue[]
): Promise<ProjectedReceipt[]> {
  const allReceipts: ProjectedReceipt[] = []

  for (const monthData of forecast) {
    const receipts = await transformForecastMonthToReceipts(admin, orgId, monthData)
    allReceipts.push(...receipts)
  }

  return allReceipts
}

/**
 * INVARIANT CHECK:
 * For each month/modality:
 * SUM(receita_projetada_bruta) = receita_projetada_faixa * participacao_modalidade
 */
export function validateForecastTransformInvariant(
  monthData: MonthlyValue,
  receipts: ProjectedReceipt[]
): boolean {
  const byModality = new Map<string, number>()

  for (const receipt of receipts.filter((r) => r.data_venda.getMonth() === monthData.mes - 1)) {
    const key = receipt.modalidade
    byModality.set(key, (byModality.get(key) || 0) + receipt.receita_projetada_bruta)
  }

  // For the full month, sum should be ≈ monthData.value (within rounding)
  const total = Array.from(byModality.values()).reduce((a, b) => a + b, 0)
  return Math.abs(total - monthData.value) < 0.1 // allow 0.10 rounding
}
