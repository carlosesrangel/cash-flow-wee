/**
 * Forecast Pipeline: End-to-End Integration
 *
 * Orchestrates the complete forecast calculation:
 * 1. Load base forecast (revenue projection)
 * 2. Apply Sazonalidade (3-band decomposition)
 * 3. Apply Receipt Profile (payment timing)
 * 4. Apply Fee Fallback (expected fee rates)
 * 5. Generate projection events
 *
 * Power Query specification: Points 5-7, 11-13
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { calculateSeasonality3Bands, distributeBySeasonality } from './seasonality'
import { calculateReceiptProfile, projectPaymentReceipt } from './receipt_profile'
import { lookupFeeRate } from '@/lib/analytics/fee_fallback'

export interface ForecastEntry {
  month: number
  year: number
  payment_type: string
  card_type: string
  nro_parcelas: number
  entry_mode: string
  payout_plan: string
  base_amount: number // forecast revenue for this modality+month
  with_seasonality_band: number // which band (1-3)
  amount_band: number // revenue distributed to this band
  receipt_month: number // when payment expected
  receipt_year: number
  receipt_amount: number // amount expected to receive
  expected_fee_rate: number | null
  expected_fee_amount: number | null
  confiabilidade_fee: 'ALTA' | 'MEDIA' | 'BAIXA'
  confiabilidade_receipt: 'ALTA' | 'MEDIA' | 'BAIXA'
}

/**
 * Generate forecast entries for a month
 * Given base forecast, distributes through sazonalidade and receipt profile
 */
export async function generateMonthlyForecast(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  month: number,
  baseForecastByModality: Array<{
    payment_type: string
    card_type: string
    nro_parcelas: number
    entry_mode: string
    payout_plan: string
    amount: number
  }>
): Promise<ForecastEntry[]> {
  const entries: ForecastEntry[] = []

  for (const modality of baseForecastByModality) {
    // Step 1: Get seasonality for this month
    const seasonality = await calculateSeasonality3Bands(admin, orgId, year, month)

    if (!seasonality) continue

    const [band1Amount, band2Amount, band3Amount] = distributeBySeasonality(
      modality.amount,
      seasonality
    )

    // Step 2: Get receipt profile for this modality
    const receiptProfile = await calculateReceiptProfile(
      admin,
      orgId,
      modality.payment_type,
      modality.card_type,
      modality.nro_parcelas,
      modality.entry_mode,
      modality.payout_plan
    )

    if (!receiptProfile) continue

    // Step 3: Get fee rate for this modality
    const feeResult = await lookupFeeRate(
      admin,
      orgId,
      modality.payment_type,
      modality.card_type,
      modality.nro_parcelas,
      modality.entry_mode,
      modality.payout_plan
    )

    // Step 4: Project each band
    const bands = [
      { amount: band1Amount, band: 1 },
      { amount: band2Amount, band: 2 },
      { amount: band3Amount, band: 3 },
    ]

    for (const { amount, band } of bands) {
      if (amount <= 0) continue

      // Project payment receipt for this band amount
      const receipt = projectPaymentReceipt(`${year}-${String(month).padStart(2, '0')}`, receiptProfile)

      for (const receiptDist of receipt) {
        const expectedFeeAmount = amount * (feeResult.taxa || 0)

        entries.push({
          month,
          year,
          payment_type: modality.payment_type,
          card_type: modality.card_type,
          nro_parcelas: modality.nro_parcelas,
          entry_mode: modality.entry_mode,
          payout_plan: modality.payout_plan,
          base_amount: modality.amount,
          with_seasonality_band: band,
          amount_band: amount,
          receipt_month: receiptDist.month,
          receipt_year: receiptDist.year,
          receipt_amount: receiptDist.expected_amount,
          expected_fee_rate: feeResult.taxa,
          expected_fee_amount: expectedFeeAmount,
          confiabilidade_fee: feeResult.confiabilidade,
          confiabilidade_receipt: receiptProfile.confiabilidade,
        })
      }
    }
  }

  return entries
}

/**
 * Aggregate forecast entries by receipt date
 * Groups all modalities and bands that should be received on same month
 */
export function aggregateByReceiptDate(
  entries: ForecastEntry[]
): Array<{
  receipt_year: number
  receipt_month: number
  gross_amount: number
  total_fees: number
  net_amount: number
  transaction_count: number
  confidence_min: string
}> {
  const byDate = new Map<
    string,
    {
      gross: number
      fees: number
      count: number
      confidences: string[]
    }
  >()

  for (const entry of entries) {
    const key = `${entry.receipt_year}-${String(entry.receipt_month).padStart(2, '0')}`
    const existing = byDate.get(key) || {
      gross: 0,
      fees: 0,
      count: 0,
      confidences: [],
    }

    existing.gross += entry.receipt_amount
    existing.fees += entry.expected_fee_amount || 0
    existing.count += 1
    existing.confidences.push(entry.confiabilidade_fee)

    byDate.set(key, existing)
  }

  const results = []
  for (const [key, data] of byDate.entries()) {
    const [year, month] = key.split('-').map(Number)
    const confidenceRanking = { ALTA: 3, MEDIA: 2, BAIXA: 1 }
    const minConfidence = Math.min(
      ...data.confidences.map((c) => confidenceRanking[c as keyof typeof confidenceRanking] || 0)
    )
    const confidenceLabel =
      minConfidence === 3 ? 'ALTA' : minConfidence === 2 ? 'MEDIA' : 'BAIXA'

    results.push({
      receipt_year: year,
      receipt_month: month,
      gross_amount: data.gross,
      total_fees: data.fees,
      net_amount: data.gross - data.fees,
      transaction_count: data.count,
      confidence_min: confidenceLabel,
    })
  }

  return results.sort((a, b) => {
    const dateA = a.receipt_year * 12 + a.receipt_month
    const dateB = b.receipt_year * 12 + b.receipt_month
    return dateA - dateB
  })
}
