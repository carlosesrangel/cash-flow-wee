/**
 * Forecast Pipeline: End-to-End Integration
 *
 * Orchestrates the complete forecast calculation:
 * 1. Input: Monthly forecast (year, month, revenue)
 * 2. Seasonality: Decompose into 3 bands (days 1-9, 10-19, 20-31)
 * 3. Payment Mix: Distribute each band across modalities
 * 4. Fee Lookup: Calculate fee rate per modality
 * 5. Receipt Profile: Calculate months-to-receipt distribution
 * 6. Dates: Create sale_date and receipt_date
 * 7. Gross/Fee/Net: Final calculations
 * 8. Aggregation: Group by receipt date
 *
 * Power Query specification: Full pipeline
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { calculateSeasonality3Bands, distributeBySeasonality } from './seasonality'
import { calculatePaymentMix, distributeAcrossModalities } from './payment_mix'
import { calculateReceiptProfile, projectPaymentReceipt } from './receipt_profile'
import { lookupProjectedSaleFeeRate } from '@/lib/analytics/fee_fallback'

export interface ForecastEntry {
  year: number
  month: number
  sale_date: Date // actual sale date based on band
  payment_type: string
  card_type: string
  nro_parcelas: number
  entry_mode: string
  payout_plan: string
  banda: number // seasonality band 1-3
  amount_venda_modalidade: number // sale amount for this modality+band
  taxa_venda: number | null // fee rate
  fee_venda: number // fee on sale
  receipt_month: number
  receipt_year: number
  receipt_day: number // specific day
  receipt_date: Date
  amount_recebimento: number // gross receipt
  fee_recebimento: number // fee portion of receipt
  amount_liquido_recebimento: number // net receipt
  confiabilidade_seasonality: string
  confiabilidade_mix: string
  confiabilidade_fee: string
  confiabilidade_receipt: string
}

interface BandData {
  band: number
  day: number
  amount: number
}

/**
 * Generate forecast entries for a month
 * Input: year, month, base revenue (no pre-split)
 */
export async function generateMonthlyForecast(
  admin: SupabaseClient,
  orgId: string,
  year: number,
  month: number,
  baseRevenue: number
): Promise<ForecastEntry[]> {
  const entries: ForecastEntry[] = []

  // Step 1: Get seasonality
  const seasonality = await calculateSeasonality3Bands(admin, orgId, year, month)
  if (!seasonality || seasonality.receita_mes === undefined) {
    return [] // no seasonality data
  }

  // Step 2: Distribute across bands
  const [band1Amount, band2Amount, band3Amount] = distributeBySeasonality(baseRevenue, seasonality)

  const bands: BandData[] = [
    { band: 1, day: 1, amount: band1Amount },
    { band: 2, day: 10, amount: band2Amount },
    { band: 3, day: 20, amount: band3Amount },
  ]

  // Step 3: Get payment mix
  const mix = await calculatePaymentMix(admin, orgId)
  if (!mix || mix.modalities.length === 0) {
    return [] // no modality data
  }

  // Step 4: For each band, distribute across modalities
  for (const bandData of bands) {
    if (bandData.amount <= 0) continue

    const distributed = distributeAcrossModalities(bandData.amount, mix)

    for (const modality of distributed) {
      if (modality.amount <= 0) continue

      // Step 5: Get receipt profile for this modality
      const receiptProfile = await calculateReceiptProfile(
        admin,
        orgId,
        modality.payment_type,
        modality.card_type,
        modality.nro_parcelas,
        modality.entry_mode,
        modality.payout_plan
      )

      // Step 6: Get fee rate
      const feeResult = await lookupProjectedSaleFeeRate(
        admin,
        orgId,
        modality.payment_type,
        modality.card_type,
        modality.nro_parcelas,
        modality.entry_mode,
        modality.payout_plan
      )

      // Step 7: Create sale date based on band
      const saleDateObj = new Date(year, month - 1, bandData.day)
      const yearMonthStr = `${year}-${String(month).padStart(2, '0')}`

      // Step 8: Calculate fee on sale
      const feeAmount = Math.round(modality.amount * (feeResult.taxa || 0) * 100) / 100

      // Step 9: Project receipts
      let receiptsProjected: Array<{
        year: number
        month: number
        day: number
        expected_amount: number
        pct: number
      }> = []

      if (receiptProfile && receiptProfile.distributions.length > 0) {
        receiptsProjected = projectPaymentReceipt(modality.amount, yearMonthStr, receiptProfile)
      } else {
        // Fallback: same month, 100%
        receiptsProjected = [
          {
            year,
            month,
            day: bandData.day,
            expected_amount: modality.amount,
            pct: 1.0,
          },
        ]
      }

      // Step 10: For each receipt, create forecast entry
      for (const receipt of receiptsProjected) {
        // Fee portion of this receipt (proportional)
        const feeReceipt = Math.round(feeAmount * receipt.pct * 100) / 100
        const netReceipt = Math.round((receipt.expected_amount - feeReceipt) * 100) / 100

        const receiptDateObj = new Date(receipt.year, receipt.month - 1, receipt.day)

        entries.push({
          year,
          month,
          sale_date: saleDateObj,
          payment_type: modality.payment_type,
          card_type: modality.card_type,
          nro_parcelas: modality.nro_parcelas,
          entry_mode: modality.entry_mode,
          payout_plan: modality.payout_plan,
          banda: bandData.band,
          amount_venda_modalidade: modality.amount,
          taxa_venda: feeResult.taxa,
          fee_venda: feeAmount,
          receipt_month: receipt.month,
          receipt_year: receipt.year,
          receipt_day: receipt.day,
          receipt_date: receiptDateObj,
          amount_recebimento: Math.round(receipt.expected_amount * 100) / 100,
          fee_recebimento: feeReceipt,
          amount_liquido_recebimento: netReceipt,
          confiabilidade_seasonality: seasonality.fallback_used,
          confiabilidade_mix: 'mix', // placeholder
          confiabilidade_fee: feeResult.source,
          confiabilidade_receipt: receiptProfile?.confiabilidade || 'BAIXA',
        })
      }
    }
  }

  return entries
}

/**
 * Aggregate forecast entries by receipt date
 */
export function aggregateByReceiptDate(
  entries: ForecastEntry[]
): Array<{
  receipt_year: number
  receipt_month: number
  receipt_day: number
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
      day: number
    }
  >()

  for (const entry of entries) {
    const key = `${entry.receipt_year}-${String(entry.receipt_month).padStart(2, '0')}`
    const existing = byDate.get(key) || {
      gross: 0,
      fees: 0,
      count: 0,
      confidences: [],
      day: entry.receipt_day,
    }

    existing.gross += entry.amount_recebimento
    existing.fees += entry.fee_recebimento
    existing.count += 1
    existing.confidences.push(entry.confiabilidade_receipt)

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

    const grossRounded = Math.round(data.gross * 100) / 100
    const feesRounded = Math.round(data.fees * 100) / 100
    const netRounded = Math.round((grossRounded - feesRounded) * 100) / 100

    results.push({
      receipt_year: year,
      receipt_month: month,
      receipt_day: data.day,
      gross_amount: grossRounded,
      total_fees: feesRounded,
      net_amount: netRounded,
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
