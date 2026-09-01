/**
 * Financial Model V2: Fee Rate Calculation (Taxas_12M)
 *
 * Implements paridade with legacy Excel Power Query: Taxas_12M
 *
 * Historical fee aggregation for 12-month window
 * Dimensions: payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan
 *
 * Applies 4-tier fallback hierarchy when projecting fees
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type FeeRateRow = any

export type FeeCalculationResult = {
  taxaMediaPonderada: number | null
  fonte: 'COMBINACAO_EXATA' | 'MODALIDADE_E_PARCELAS' | 'MODALIDADE' | 'TAXA_GLOBAL'
  confiabilidade: 'ALTA' | 'MEDIA' | 'BAIXA' | 'NENHUMA'
}

/**
 * Get normalized installment count from SumUp transaction
 * - if installments_count > 0: use it
 * - else if payouts_total > 0: use payouts_total
 * - else: 1
 */
export function getNroParcelasModelo(
  installments_count: number | null,
  payouts_total: number | null
): number {
  if (installments_count && installments_count > 0) return installments_count
  if (payouts_total && payouts_total > 0) return Math.round(payouts_total)
  return 1
}

/**
 * Normalize payment type and card type strings for analytics
 */
export function normalizeFinancialString(input: string | null | undefined): string {
  if (!input || input.trim() === '') return 'NAO_INFORMADO'
  return input.toUpperCase().trim()
}

/**
 * Calculate 12-month fee rates from SumUp transactions
 *
 * Logic:
 * 1. Select PAYMENT + SUCCESSFUL + amount > 0
 * 2. Group by: payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan
 * 3. For each group:
 *    - Find payouts (status=SUCCESSFUL, type=PAYOUT) by transaction_code
 *    - Only include fee if payouts_received >= payouts_total (complete payout)
 *    - Calculate taxa_media_ponderada = fee_total / valor_base_taxa
 * 4. Calculate confiabilidade based on qtd_com_fee
 */
export async function calculateFeeRates12M(
  admin: AdminClient,
  orgId: string,
  windowDays: number = 365
): Promise<FeeRateRow[]> {
  // This would be a complex SQL query in production
  // For now, placeholder that shows the structure

  const { data: rates, error } = await admin
    .from('sumup_fee_rates_12m')
    .select('*')
    .eq('org_id', orgId)

  if (error) {
    throw new Error(`Failed to load fee rates: ${error.message}`)
  }

  return rates || []
}

/**
 * Get fee rate using 4-tier fallback hierarchy
 *
 * Tier 1: Exact combination (payment_type + card_type + installments + entry_mode + payout_plan)
 *   Requires: Qtd com Fee >= 5
 *
 * Tier 2: payment_type + installments
 *   Requires: QtdFee >= 5
 *
 * Tier 3: payment_type
 *   Requires: QtdFee >= 5
 *
 * Tier 4: Global average
 *   Always available
 */
export async function getFeeRateFallback(
  admin: AdminClient,
  orgId: string,
  paymentType: string,
  cardType: string,
  nroParcelasModelo: number,
  entryMode: string,
  payoutPlan: string
): Promise<FeeCalculationResult> {
  // Normalize inputs
  const pt = normalizeFinancialString(paymentType)
  const ct = normalizeFinancialString(cardType)
  const em = normalizeFinancialString(entryMode)
  const pp = normalizeFinancialString(payoutPlan)

  // Tier 1: Exact combination
  const { data: tier1 } = await admin
    .from('sumup_fee_rates_12m')
    .select('taxa_media_ponderada, confiabilidade')
    .eq('org_id', orgId)
    .eq('payment_type', pt)
    .eq('card_type', ct)
    .eq('nro_parcelas_modelo', nroParcelasModelo)
    .eq('entry_mode', em)
    .eq('payout_plan', pp)
    .maybeSingle()

  if (tier1 && tier1.taxa_media_ponderada !== null && tier1.confiabilidade !== 'BAIXA') {
    return {
      taxaMediaPonderada: tier1.taxa_media_ponderada,
      fonte: 'COMBINACAO_EXATA',
      confiabilidade: (tier1.confiabilidade as any) || 'MEDIA',
    }
  }

  // Tier 2: payment_type + installments
  const { data: tier2Records } = await admin
    .from('sumup_fee_rates_12m')
    .select('taxa_media_ponderada, confiabilidade, qtd_com_fee')
    .eq('org_id', orgId)
    .eq('payment_type', pt)
    .eq('nro_parcelas_modelo', nroParcelasModelo)
    .filter('qtd_com_fee', 'gte', 5)

  if (tier2Records && tier2Records.length > 0) {
    const avgRate = tier2Records.reduce((sum, r) => sum + (r.taxa_media_ponderada || 0), 0) / tier2Records.length
    return {
      taxaMediaPonderada: avgRate,
      fonte: 'MODALIDADE_E_PARCELAS',
      confiabilidade: 'MEDIA',
    }
  }

  // Tier 3: payment_type only
  const { data: tier3Records } = await admin
    .from('sumup_fee_rates_12m')
    .select('taxa_media_ponderada, confiabilidade, qtd_com_fee')
    .eq('org_id', orgId)
    .eq('payment_type', pt)
    .filter('qtd_com_fee', 'gte', 5)

  if (tier3Records && tier3Records.length > 0) {
    const avgRate = tier3Records.reduce((sum, r) => sum + (r.taxa_media_ponderada || 0), 0) / tier3Records.length
    return {
      taxaMediaPonderada: avgRate,
      fonte: 'MODALIDADE',
      confiabilidade: 'MEDIA',
    }
  }

  // Tier 4: Global average
  const { data: tier4 } = await admin
    .from('sumup_fee_rates_12m')
    .select('taxa_media_ponderada')
    .eq('org_id', orgId)

  if (tier4 && tier4.length > 0) {
    const globalRate = tier4.reduce((sum, r) => sum + (r.taxa_media_ponderada || 0), 0) / tier4.length
    return {
      taxaMediaPonderada: globalRate || 0,
      fonte: 'TAXA_GLOBAL',
      confiabilidade: 'BAIXA',
    }
  }

  // Fallback: no data
  return {
    taxaMediaPonderada: null,
    fonte: 'TAXA_GLOBAL',
    confiabilidade: 'NENHUMA',
  }
}

/**
 * Apply fee to a projected receipt amount
 */
export function calculateFeeOnAmount(amount: number, taxaMediaPonderada: number): number {
  if (!taxaMediaPonderada || taxaMediaPonderada < 0) return 0
  return Math.round(amount * taxaMediaPonderada * 100) / 100 // Round to 2 decimals
}

/**
 * Calculate net receipt (bruto - fee)
 */
export function calculateNetReceipt(bruto: number, fee: number): number {
  const net = bruto - fee
  return Math.round(net * 100) / 100 // Round to 2 decimals
}
