/**
 * Sazonalidade Engine: 3-Band Monthly Distribution
 *
 * Decomposes monthly revenue into 3 bands (days 1-9, 10-19, 20-31)
 * with fallback hierarchy per Power Query specification:
 *
 * Tier 1: Same month previous year
 * Tier 2: Same month most recent year available
 * Tier 3: Global 12-month average (last 12M before projection)
 * Tier 4: Uniform fallback (1/3 each) if no history
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
  fallback_used:
    | 'SAME_MONTH_PREVIOUS_YEAR'
    | 'SAME_MONTH_MOST_RECENT'
    | 'GLOBAL_12M'
    | 'ALL_HISTORY'
    | 'SEM_HISTORICO_UNIFORME'
}

/**
 * Calculate seasonality bands for an organization
 * Uses historical transactions to determine band distribution
 */
export async function calculateSeasonality3Bands(
  admin: SupabaseClient,
  orgId: string,
  targetYear: number,
  targetMonth: number
): Promise<SeasonalityBands> {
  // Load all historical transactions (no arbitrary limit)
  const { data: transactions, error } = await admin
    .from('sumup_transactions')
    .select('created_at, amount, refunded_amount')
    .eq('org_id', orgId)
    .eq('type', 'PAYMENT')
    .eq('status', 'SUCCESSFUL')
    .gt('amount', 0)
    .order('created_at', { ascending: true })

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

    // Net revenue: amount - refunded, floored at 0
    const net = Math.max(0, (tx.amount || 0) - (tx.refunded_amount || 0))

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

  // Tier 1: Same month previous year
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
      fallback_used: 'SAME_MONTH_PREVIOUS_YEAR',
    }
  }

  // Tier 2: Same month most recent year available
  // Find the most recent year that has this month
  let mostRecentYear: { band1: number; band2: number; band3: number; total: number } | null = null
  let foundYear = -1

  for (let checkYear = targetYear - 2; checkYear >= 1900; checkYear--) {
    const key = `${checkYear}-${String(targetMonth).padStart(2, '0')}`
    const candidate = bandsByMonth.get(key)
    if (candidate && candidate.total > 0) {
      mostRecentYear = candidate
      foundYear = checkYear
      break
    }
  }

  if (mostRecentYear && mostRecentYear.total > 0) {
    return {
      ano: targetYear,
      mes: targetMonth,
      band1_peso: mostRecentYear.band1 / mostRecentYear.total,
      band2_peso: mostRecentYear.band2 / mostRecentYear.total,
      band3_peso: mostRecentYear.band3 / mostRecentYear.total,
      receita_mes: mostRecentYear.total,
      fallback_used: 'SAME_MONTH_MOST_RECENT',
    }
  }

  // Tier 3: Global 12-month average (last 12 months before target date)
  const targetDate = new Date(targetYear, targetMonth - 1, 1)
  const windowStart = new Date(targetDate)
  windowStart.setMonth(windowStart.getMonth() - 12)

  const last12m = { band1: 0, band2: 0, band3: 0, total: 0 }

  for (const [key, bands] of bandsByMonth.entries()) {
    const [y, m] = key.split('-').map(Number)
    const checkDate = new Date(y, m - 1, 1)

    if (checkDate >= windowStart && checkDate < targetDate) {
      last12m.band1 += bands.band1
      last12m.band2 += bands.band2
      last12m.band3 += bands.band3
      last12m.total += bands.total
    }
  }

  if (last12m.total > 0) {
    return {
      ano: targetYear,
      mes: targetMonth,
      band1_peso: last12m.band1 / last12m.total,
      band2_peso: last12m.band2 / last12m.total,
      band3_peso: last12m.band3 / last12m.total,
      receita_mes: last12m.total,
      fallback_used: 'GLOBAL_12M',
    }
  }

  // Tier 3b: All history available
  const allHistory = { band1: 0, band2: 0, band3: 0, total: 0 }
  for (const bands of bandsByMonth.values()) {
    allHistory.band1 += bands.band1
    allHistory.band2 += bands.band2
    allHistory.band3 += bands.band3
    allHistory.total += bands.total
  }

  if (allHistory.total > 0) {
    return {
      ano: targetYear,
      mes: targetMonth,
      band1_peso: allHistory.band1 / allHistory.total,
      band2_peso: allHistory.band2 / allHistory.total,
      band3_peso: allHistory.band3 / allHistory.total,
      receita_mes: allHistory.total,
      fallback_used: 'ALL_HISTORY',
    }
  }

  // Tier 4: Uniform fallback (no history)
  return {
    ano: targetYear,
    mes: targetMonth,
    band1_peso: 1 / 3,
    band2_peso: 1 / 3,
    band3_peso: 1 / 3,
    receita_mes: 0,
    fallback_used: 'SEM_HISTORICO_UNIFORME',
  }
}

/**
 * Validate seasonality invariants
 * SUM(band_peso) should = 1.0
 */
export function validateSeasonalityInvariants(bands: SeasonalityBands): boolean {
  const sum = bands.band1_peso + bands.band2_peso + bands.band3_peso
  return Math.abs(sum - 1.0) < 0.0001
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
