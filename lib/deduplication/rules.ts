/**
 * Deduplication rules and validation
 * Prevents double-counting in the financial ledger
 *
 * Core principle: Every unique cash movement gets exactly one ledger entry
 */

import { SupabaseClient } from '@supabase/supabase-js'

export interface DuplicateCandidate {
  id1: string
  id2: string
  source: string
  nature: string
  reason: string
  amount: number
  event_date: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface DeduplicationResult {
  total_checked: number
  duplicates_found: number
  candidates: DuplicateCandidate[]
  rules_applied: string[]
}

/**
 * Rule 1: Same source_id cannot appear twice
 * SumUp transaction can only generate one ledger entry per status
 */
export async function checkDuplicateSourceId(
  admin: SupabaseClient,
  orgId: string
): Promise<DuplicateCandidate[]> {
  const { data: duplicates, error } = await admin
    .from('financial_ledger')
    .select('id, source, source_id, amount, event_date, nature')
    .eq('org_id', orgId)
    .not('source_id', 'is', null)

  if (error) {
    throw error
  }

  const candidates: DuplicateCandidate[] = []
  const seen = new Map<string, any>()

  for (const entry of duplicates || []) {
    const key = `${entry.source}:${entry.source_id}`
    if (seen.has(key)) {
      const existing = seen.get(key)
      candidates.push({
        id1: existing.id,
        id2: entry.id,
        source: entry.source,
        nature: entry.nature,
        reason: 'Same source_id cannot appear twice',
        amount: entry.amount,
        event_date: entry.event_date,
        confidence: 'HIGH',
      })
    } else {
      seen.set(key, entry)
    }
  }

  return candidates
}

/**
 * Rule 2: SumUp payout + fee double-count protection
 * If we record SUMUP_PAYOUT_ACTUAL for amount X with fee Y,
 * we must NOT also record SUMUP_FEE_COST with the same source_id
 */
export async function checkSumUpPayoutFeeDoubleCount(
  admin: SupabaseClient,
  orgId: string
): Promise<DuplicateCandidate[]> {
  const { data: payouts, error: payoutError } = await admin
    .from('financial_ledger')
    .select('id, source_id, amount, event_date')
    .eq('org_id', orgId)
    .eq('nature', 'SUMUP_PAYOUT_ACTUAL')

  if (payoutError) {
    throw payoutError
  }

  const { data: fees, error: feeError } = await admin
    .from('financial_ledger')
    .select('id, source_id, amount, event_date')
    .eq('org_id', orgId)
    .eq('nature', 'SUMUP_FEE_COST')

  if (feeError) {
    throw feeError
  }

  const candidates: DuplicateCandidate[] = []
  const feeIds = new Set((fees || []).map((f) => f.source_id))

  for (const payout of payouts || []) {
    if (feeIds.has(payout.source_id)) {
      const fee = (fees || []).find((f) => f.source_id === payout.source_id)
      candidates.push({
        id1: payout.id,
        id2: fee!.id,
        source: 'sumup',
        nature: 'PAYOUT_FEE_DOUBLE_COUNT',
        reason: 'Same SumUp transaction generates both payout and fee entries',
        amount: payout.amount,
        event_date: payout.event_date,
        confidence: 'MEDIUM',
      })
    }
  }

  return candidates
}

/**
 * Rule 3: Forecast + actual revenue double-count
 * If we have FORECAST_REVENUE_PROJECTION for a month,
 * and later SUMUP_PAYOUT_ACTUAL for the same month,
 * we should replace forecast with actual (not keep both)
 */
export async function checkForecastActualDoubleCount(
  admin: SupabaseClient,
  orgId: string
): Promise<DuplicateCandidate[]> {
  const { data: entries, error } = await admin
    .from('financial_ledger')
    .select('id, nature, amount, event_date, status')
    .eq('org_id', orgId)
    .in('nature', ['FORECAST_REVENUE_PROJECTION', 'SUMUP_PAYOUT_ACTUAL'])
    .order('event_date')

  if (error) {
    throw error
  }

  const candidates: DuplicateCandidate[] = []
  const byMonth = new Map<string, any[]>()

  for (const entry of entries || []) {
    const month = entry.event_date.substring(0, 7) // YYYY-MM
    if (!byMonth.has(month)) {
      byMonth.set(month, [])
    }
    byMonth.get(month)!.push(entry)
  }

  for (const [month, monthEntries] of byMonth) {
    const hasForecast = monthEntries.some((e) => e.nature === 'FORECAST_REVENUE_PROJECTION')
    const hasActual = monthEntries.some((e) => e.nature === 'SUMUP_PAYOUT_ACTUAL' && e.status === 'actual')

    if (hasForecast && hasActual) {
      const forecastEntry = monthEntries.find((e) => e.nature === 'FORECAST_REVENUE_PROJECTION')
      const actualEntry = monthEntries.find((e) => e.nature === 'SUMUP_PAYOUT_ACTUAL' && e.status === 'actual')

      if (forecastEntry && actualEntry) {
        candidates.push({
          id1: forecastEntry.id,
          id2: actualEntry.id,
          source: 'mixed',
          nature: 'FORECAST_ACTUAL_CONFLICT',
          reason: `Both forecast projection and actual receipt exist for ${month}. Keep actual, remove forecast.`,
          amount: forecastEntry.amount,
          event_date: forecastEntry.event_date,
          confidence: 'HIGH',
        })
      }
    }
  }

  return candidates
}

/**
 * Rule 4: Tiny + Olist same transaction
 * If we get duplicate entries from different aggregation sources
 */
export async function checkMultiSourceDuplicates(
  admin: SupabaseClient,
  orgId: string
): Promise<DuplicateCandidate[]> {
  const { data: entries, error } = await admin
    .from('financial_ledger')
    .select('id, source, amount, event_date, description')
    .eq('org_id', orgId)
    .in('source', ['tiny', 'olist'])
    .order('event_date')

  if (error) {
    throw error
  }

  const candidates: DuplicateCandidate[] = []
  const byDateAmount = new Map<string, any[]>()

  for (const entry of entries || []) {
    const key = `${entry.event_date}:${Math.round(entry.amount)}`
    if (!byDateAmount.has(key)) {
      byDateAmount.set(key, [])
    }
    byDateAmount.get(key)!.push(entry)
  }

  for (const [key, entries] of byDateAmount) {
    if (entries.length > 1 && entries.some((e) => e.source === 'tiny') && entries.some((e) => e.source === 'olist')) {
      // Potential multi-source duplicate
      const entry1 = entries[0]
      const entry2 = entries[1]

      candidates.push({
        id1: entry1.id,
        id2: entry2.id,
        source: `${entry1.source}+${entry2.source}`,
        nature: 'MULTI_SOURCE_DUPLICATE',
        reason: `Same amount on same date from multiple sources. May be duplicate aggregation.`,
        amount: entry1.amount,
        event_date: entry1.event_date,
        confidence: 'MEDIUM',
      })
    }
  }

  return candidates
}

/**
 * Full deduplication audit
 */
export async function auditLedgerForDuplicates(admin: SupabaseClient, orgId: string): Promise<DeduplicationResult> {
  const allCandidates: DuplicateCandidate[] = []
  const rulesApplied: string[] = []

  try {
    // Rule 1: Source ID duplicates
    const sourceIdDuplicates = await checkDuplicateSourceId(admin, orgId)
    if (sourceIdDuplicates.length > 0) {
      allCandidates.push(...sourceIdDuplicates)
      rulesApplied.push('duplicate_source_id')
    }

    // Rule 2: SumUp payout + fee double-count
    const payoutFeeDuplicates = await checkSumUpPayoutFeeDoubleCount(admin, orgId)
    if (payoutFeeDuplicates.length > 0) {
      allCandidates.push(...payoutFeeDuplicates)
      rulesApplied.push('sumup_payout_fee_conflict')
    }

    // Rule 3: Forecast + actual double-count
    const forecastActualDuplicates = await checkForecastActualDoubleCount(admin, orgId)
    if (forecastActualDuplicates.length > 0) {
      allCandidates.push(...forecastActualDuplicates)
      rulesApplied.push('forecast_actual_conflict')
    }

    // Rule 4: Multi-source duplicates
    const multiSourceDuplicates = await checkMultiSourceDuplicates(admin, orgId)
    if (multiSourceDuplicates.length > 0) {
      allCandidates.push(...multiSourceDuplicates)
      rulesApplied.push('multi_source_duplicate')
    }

    // Get total ledger entries
    const { count } = await admin
      .from('financial_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)

    return {
      total_checked: count || 0,
      duplicates_found: allCandidates.length,
      candidates: allCandidates,
      rules_applied: rulesApplied,
    }
  } catch (error) {
    console.error('Deduplication audit error:', error)
    return {
      total_checked: 0,
      duplicates_found: 0,
      candidates: [],
      rules_applied: [],
    }
  }
}

/**
 * Remove a ledger entry (only for identified duplicates)
 * Creates audit trail by marking as deleted
 */
export async function markLedgerEntryAsRemoved(admin: SupabaseClient, ledgerId: string, reason: string) {
  const { error } = await admin
    .from('financial_ledger')
    .update({
      metadata: {
        removed_reason: reason,
        removed_at: new Date().toISOString(),
      },
    })
    .eq('id', ledgerId)

  if (error) {
    throw error
  }

  return { success: true, ledger_id: ledgerId }
}
