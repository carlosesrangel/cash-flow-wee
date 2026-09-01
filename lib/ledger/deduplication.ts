/**
 * Financial Ledger: Deduplication & Versioning Strategy
 *
 * Hybrid approach: Persisted TABLE with versioning
 * - Supports multiple sources (SUMUP, FORECAST, TINY, MANUAL)
 * - Tracks both actual and scheduled payouts
 * - Handles payout status transitions (SCHEDULED → SUCCESSFUL)
 * - Maintains history for audit trail
 *
 * Power Query specification: Points 13-14, 22-24
 */

import { SupabaseClient } from '@supabase/supabase-js'

export type LedgerSource = 'SUMUP' | 'FORECAST' | 'TINY' | 'MANUAL' | 'ADJUSTMENT'
export type LedgerNature =
  | 'SUMUP_PAYOUT_ACTUAL'
  | 'SUMUP_PAYOUT_SCHEDULED'
  | 'PROJECTED_SALES'
  | 'TINY_PAYABLE_ACTUAL'
  | 'MANUAL_ENTRY'
  | 'TAX_LIABILITY'

export type LedgerDirection = 'entrada' | 'saida'
export type LedgerStatus = 'actual' | 'scheduled' | 'projected' | 'manual'

export interface LedgerEntry {
  id?: string
  org_id: string
  source: LedgerSource
  source_id: string // id in source table
  source_event_id?: string // for multi-event sources (payouts with multiple payout_ids)
  projection_version_id?: string // for FORECAST entries
  nature: LedgerNature
  event_date: string // YYYY-MM-DD
  amount: number
  direction: LedgerDirection
  status: LedgerStatus
  description?: string
  generated_at: string // when entry was created (ISO timestamp)
  valid_from: string // when this version becomes active (ISO timestamp)
  superseded_at?: string | null // when this version was replaced (NULL = current)
  metadata?: Record<string, any>
}

/**
 * Dedup key: (org_id, source, source_id, source_event_id, event_date, status)
 * When payout status changes SCHEDULED → SUCCESSFUL:
 * 1. Set superseded_at = now() on old SCHEDULED entry
 * 2. INSERT new SUCCESSFUL entry
 * 3. Keep both for history
 */
export function generateLedgerDedupKey(entry: LedgerEntry): string {
  return `${entry.org_id}|${entry.source}|${entry.source_id}|${entry.source_event_id || 'NULL'}|${entry.event_date}|${entry.status}`
}

/**
 * Check if entry already exists (dedup)
 * Returns existing entry ID if found, null otherwise
 */
export async function checkDuplicateLedgerEntry(
  admin: SupabaseClient,
  entry: LedgerEntry
): Promise<string | null> {
  const dedupKey = generateLedgerDedupKey(entry)

  const { data } = await admin
    .from('financial_ledger')
    .select('id')
    .eq('org_id', entry.org_id)
    .eq('source', entry.source)
    .eq('source_id', entry.source_id)
    .eq('source_event_id', entry.source_event_id || null)
    .eq('event_date', entry.event_date)
    .eq('status', entry.status)
    .is('superseded_at', null) // only check current (non-superseded) entries
    .single()

  return data?.id || null
}

/**
 * Handle payout status transition
 * When a payout changes from SCHEDULED to SUCCESSFUL:
 * 1. Find old SCHEDULED entry
 * 2. Set its superseded_at = now()
 * 3. Insert new SUCCESSFUL entry
 */
export async function transitionPayoutStatus(
  admin: SupabaseClient,
  org_id: string,
  payout_id: string,
  newStatus: 'SUCCESSFUL' | 'FAILED',
  updatedAmount?: number
): Promise<{ superseded_id: string; new_id: string }> {
  // Find existing SCHEDULED entry
  const { data: existing, error: findError } = await admin
    .from('financial_ledger')
    .select('id, amount')
    .eq('org_id', org_id)
    .eq('source', 'SUMUP')
    .eq('source_id', payout_id)
    .eq('status', 'scheduled')
    .is('superseded_at', null)
    .single()

  if (findError || !existing) {
    throw new Error(`No existing SCHEDULED payout found for ${payout_id}`)
  }

  // Update old entry: set superseded_at
  const now = new Date().toISOString()
  const { error: updateError } = await admin
    .from('financial_ledger')
    .update({ superseded_at: now })
    .eq('id', existing.id)

  if (updateError) throw updateError

  // Insert new SUCCESSFUL entry
  const newStatus_normalized = newStatus === 'SUCCESSFUL' ? 'actual' : 'scheduled'
  const { data: newEntry, error: insertError } = await admin
    .from('financial_ledger')
    .insert({
      org_id,
      source: 'SUMUP',
      source_id: payout_id,
      nature: 'SUMUP_PAYOUT_ACTUAL',
      event_date: new Date().toISOString().split('T')[0],
      amount: updatedAmount || existing.amount,
      direction: 'entrada',
      status: newStatus_normalized,
      generated_at: now,
      valid_from: now,
      superseded_at: null,
    })
    .select('id')
    .single()

  if (insertError) throw insertError

  return {
    superseded_id: existing.id,
    new_id: newEntry.id,
  }
}

/**
 * Insert ledger entry (with dedup check)
 * Skips insert if exact duplicate exists
 */
export async function insertLedgerEntry(
  admin: SupabaseClient,
  entry: LedgerEntry
): Promise<{ id: string; created: boolean }> {
  // Check for existing
  const existingId = await checkDuplicateLedgerEntry(admin, entry)
  if (existingId) {
    return { id: existingId, created: false }
  }

  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('financial_ledger')
    .insert({
      ...entry,
      generated_at: entry.generated_at || now,
      valid_from: entry.valid_from || now,
      superseded_at: entry.superseded_at || null,
    })
    .select('id')
    .single()

  if (error) throw error

  return { id: data.id, created: true }
}

/**
 * Load ledger entries for a month
 * Includes only current (non-superseded) entries
 */
export async function loadLedgerForMonth(
  admin: SupabaseClient,
  org_id: string,
  year: number,
  month: number
): Promise<LedgerEntry[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`

  const { data, error } = await admin
    .from('financial_ledger')
    .select('*')
    .eq('org_id', org_id)
    .gte('event_date', startDate)
    .lt('event_date', endDate)
    .is('superseded_at', null) // only current entries

  if (error) throw error
  return (data || []) as LedgerEntry[]
}

/**
 * Aggregate ledger by direction for cash flow calculation
 */
export function aggregateLedgerByDirection(entries: LedgerEntry[]): {
  entradas: number
  saidas: number
  net: number
} {
  let entradas = 0
  let saidas = 0

  for (const entry of entries) {
    if (entry.direction === 'entrada') {
      entradas += entry.amount
    } else {
      saidas += entry.amount
    }
  }

  return {
    entradas,
    saidas,
    net: entradas - saidas,
  }
}

/**
 * Separate ledger by status for forecast vs actual
 */
export function separateLedgerByStatus(entries: LedgerEntry[]): {
  actual: LedgerEntry[]
  scheduled: LedgerEntry[]
  projected: LedgerEntry[]
} {
  return {
    actual: entries.filter((e) => e.status === 'actual'),
    scheduled: entries.filter((e) => e.status === 'scheduled'),
    projected: entries.filter((e) => e.status === 'projected'),
  }
}
