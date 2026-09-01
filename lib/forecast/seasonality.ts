/**
 * Sazonalidade Engine: 3-Band Monthly Distribution
 *
 * Decomposes monthly revenue into 3 bands (days 1-9, 10-19, 20-31)
 * with fallback hierarchy for incomplete data:
 * 1. Year-specific (same year/month, previous year)
 * 2. Recent average (last 6 months regardless of year)
 * 3. Global 12M average
 * 4. Default: equal split (1/3 each)
 *
 * Power Query specification: Points 11-13
 */

import { SupabaseClient } from '@supabase/supabase-js'

export interface SeasonalityBands {
  ano: number
  mes: number
  band1_peso: number // days 1-9
  band2_peso: number // days 10-19
  band3_peso: number // days 20-31
  receita_mes: number // total for reference
  fallback_used: 'HISTORICAL' | 'RECENT' | 'GLOBAL' | 'DEFAULT'
}

/**
 * Calculate seasonality bands for an organization
 * Uses 24-month historical window for fallbacks
 */
export async function calculateSeasonality3Bands(
  admin: SupabaseClient,
  orgId: string,
  targetYear: number,
  targetMonth: number
): Promise<SeasonalityBands> {
  // Load 24-month historical transactions
  const windowEnd = new Date()
  windowEnd.setFullYear(targetYear, targetMonth - 1, 1)
  windowEnd.setDate(0) // last day of target month

  const windowStart = new Date()
  windowStart.setFullYear(targetYear - 2, targetMonth - 1, 1) // 24M ago

  const startDate = windowStart.toISOString().split('T')[0]
  const endDate = windowEnd.toISOString().split('T')[0]

  // Load transactions grouped by month and band
  const { data: transactions, error } = await admin
    .from('sumup_transactions')
    .select('created_at, amount, refunded_amount')
    .eq('org_id', orgId)
    .eq('type', 'PAYMENT')
    .eq('status', 'SUCCESSFUL')
    .gt('amount', 0)
    .gte('created_at', `${startDate}T00:00:00Z`)
    .lte('created_at', `${endDate}T23:59:59Z`)

  if (error) throw new Error(`Failed to load transactions: ${error.message}`)

  // Aggregate by month and band
  const bandsByMonth = new Map<
    string,
    {
      band1: number
      band2: number
      band3: number
      total: number
    }
  >()

  for (const tx of transactions || []) {
    const date = new Date(tx.created_at)
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    const net = (tx.amount || 0) - (tx.refunded_amount || 0)

    const key = `${year}-${String(month).padStart(2, '0')}`
    const existing = bandsByMonth.get(key) || { band1: 0, band2: 0, band3: 0, total: 0 }

    if (day <= 9) {
      existing.band1 += net
    } else if (day <= 19) {
      existing.band2 += net
    } else {
      existing.band3 += net
    }
    existing.total += net
    bandsByMonth.set(key, existing)
  }

  // Try Tier 1: Same month previous year
  const prevYearKey = `${targetYear - 1}-${String(targetMonth).padStart(2, '0')}`
  const prevYear = bandsByMonth.get(prevYearKey)

  if (prevYear && prevYear.total > 0) {
    return {
      ano: targetYear,
      mes: targetMonth,
      band1_peso: prevYear.band1 / prevYear.total,
      band2_peso: prevYear.band2 / prevYear.total,
      band3_peso: prevYear.band3 / prevYear.total,
      receita_mes: prevYear.total,
      fallback_used: 'HISTORICAL',
    }
  }

  // Try Tier 2: Recent 6-month average (any year)
  const recentStart = new Date()
  recentStart.setMonth(recentStart.getMonth() - 6)

  const recentMonths = new Map<string, { band1: number; band2: number; band3: number; total: number }>()

  for (const [key, bands] of bandsByMonth.entries()) {
    const [y, m] = key.split('-').map(Number)
    const keyDate = new Date(y, m - 1, 1)
    if (keyDate >= recentStart) {
      recentMonths.set(key, bands)
    }
  }

  if (recentMonths.size > 0) {
    const aggregated = Array.from(recentMonths.values()).reduce(
      (acc, b) => ({
        band1: acc.band1 + b.band1,
        band2: acc.band2 + b.band2,
        band3: acc.band3 + b.band3,
        total: acc.total + b.total,
      }),
      { band1: 0, band2: 0, band3: 0, total: 0 }
    )

    if (aggregated.total > 0) {
      return {
        ano: targetYear,
        mes: targetMonth,
        band1_peso: aggregated.band1 / aggregated.total,
        band2_peso: aggregated.band2 / aggregated.total,
        band3_peso: aggregated.band3 / aggregated.total,
        receita_mes: aggregated.total,
        fallback_used: 'RECENT',
      }
    }
  }

  // Try Tier 3: Global 12-month average
  const last12m = Array.from(bandsByMonth.values())
    .slice(-12)
    .reduce(
      (acc, b) => ({
        band1: acc.band1 + b.band1,
        band2: acc.band2 + b.band2,
        band3: acc.band3 + b.band3,
        total: acc.total + b.total,
      }),
      { band1: 0, band2: 0, band3: 0, total: 0 }
    )

  if (last12m.total > 0) {
    return {
      ano: targetYear,
      mes: targetMonth,
      band1_peso: last12m.band1 / last12m.total,
      band2_peso: last12m.band2 / last12m.total,
      band3_peso: last12m.band3 / last12m.total,
      receita_mes: last12m.total,
      fallback_used: 'GLOBAL',
    }
  }

  // Tier 4: Default (equal split)
  return {
    ano: targetYear,
    mes: targetMonth,
    band1_peso: 1 / 3,
    band2_peso: 1 / 3,
    band3_peso: 1 / 3,
    receita_mes: 0,
    fallback_used: 'DEFAULT',
  }
}

/**
 * Validate seasonality invariants for a month
 * SUM(band_peso) should = 1.0
 */
export function validateSeasonalityInvariants(bands: SeasonalityBands): boolean {
  const sum = bands.band1_peso + bands.band2_peso + bands.band3_peso
  return Math.abs(sum - 1.0) < 0.0001 // allow floating point error
}

/**
 * Apply seasonality distribution to forecast revenue
 * Returns [band1_amount, band2_amount, band3_amount]
 */
export function distributeBySeasonality(
  forecastAmount: number,
  bands: SeasonalityBands
): [number, number, number] {
  return [
    forecastAmount * bands.band1_peso,
    forecastAmount * bands.band2_peso,
    forecastAmount * bands.band3_peso,
  ]
}
