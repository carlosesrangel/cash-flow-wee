import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { calculateSeasonality3Bands, validateSeasonalityInvariants } from '@/lib/forecast/seasonality'
import { calculateFeeRates12M } from '@/lib/fees/calculate'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type RefreshResult = {
  phase: string
  rows_calculated: number
  rows_inserted: number
  rows_updated: number
  rows_deleted: number
  calculation_version: string
  started_at: Date
  finished_at: Date
  errors: string[]
}

/**
 * Canonical refresh orchestrator for financial analytics.
 * Populates analytical tables from raw source data (sumup_transactions, olist_orders).
 * Idempotent: multiple executions produce identical results.
 * org-scoped: operates only on target_org_id data.
 */
export async function refreshFinancialAnalytics(
  admin: AdminClient,
  orgId: string
): Promise<RefreshResult[]> {
  const results: RefreshResult[] = []
  const VERSION = 'FINANCIAL_MODEL_V2_EXCEL_PARITY'

  // PHASE 1: sumup_fee_rates_12m
  try {
    const startFees = Date.now()
    const { data: feeResult, error: feeError } = await admin.rpc('refresh_sumup_fee_rates_12m', {
      target_org_id: orgId,
    })

    if (feeError) throw feeError
    if (!feeResult) throw new Error('No result from refresh_sumup_fee_rates_12m')

    const [result] = feeResult
    results.push({
      phase: 'sumup_fee_rates_12m',
      rows_calculated: result.rows_inserted || 0,
      rows_inserted: result.rows_inserted || 0,
      rows_updated: result.rows_updated || 0,
      rows_deleted: result.rows_deleted || 0,
      calculation_version: VERSION,
      started_at: new Date(startFees),
      finished_at: new Date(),
      errors: [],
    })
  } catch (err) {
    results.push({
      phase: 'sumup_fee_rates_12m',
      rows_calculated: 0,
      rows_inserted: 0,
      rows_updated: 0,
      rows_deleted: 0,
      calculation_version: VERSION,
      started_at: new Date(),
      finished_at: new Date(),
      errors: [err instanceof Error ? err.message : String(err)],
    })
  }

  // PHASE 2: sumup_seasonality_3bands_12m
  try {
    const startSeason = Date.now()
    const { data: seasonResult, error: seasonError } = await admin.rpc(
      'refresh_sumup_seasonality_3bands_12m',
      {
        target_org_id: orgId,
      }
    )

    if (seasonError) throw seasonError
    if (!seasonResult) throw new Error('No result from refresh_sumup_seasonality_3bands_12m')

    const [result] = seasonResult
    results.push({
      phase: 'sumup_seasonality_3bands_12m',
      rows_calculated: result.rows_inserted || 0,
      rows_inserted: result.rows_inserted || 0,
      rows_updated: result.rows_updated || 0,
      rows_deleted: result.rows_deleted || 0,
      calculation_version: VERSION,
      started_at: new Date(startSeason),
      finished_at: new Date(),
      errors: [],
    })
  } catch (err) {
    results.push({
      phase: 'sumup_seasonality_3bands_12m',
      rows_calculated: 0,
      rows_inserted: 0,
      rows_updated: 0,
      rows_deleted: 0,
      calculation_version: VERSION,
      started_at: new Date(),
      finished_at: new Date(),
      errors: [err instanceof Error ? err.message : String(err)],
    })
  }

  // PHASE 3: sumup_receipt_profile_12m
  try {
    const startReceipt = Date.now()
    const { data: receiptResult, error: receiptError } = await admin.rpc(
      'refresh_sumup_receipt_profile_12m',
      {
        target_org_id: orgId,
      }
    )

    if (receiptError) throw receiptError
    if (!receiptResult) throw new Error('No result from refresh_sumup_receipt_profile_12m')

    const [result] = receiptResult
    results.push({
      phase: 'sumup_receipt_profile_12m',
      rows_calculated: result.rows_inserted || 0,
      rows_inserted: result.rows_inserted || 0,
      rows_updated: result.rows_updated || 0,
      rows_deleted: result.rows_deleted || 0,
      calculation_version: VERSION,
      started_at: new Date(startReceipt),
      finished_at: new Date(),
      errors: [],
    })
  } catch (err) {
    results.push({
      phase: 'sumup_receipt_profile_12m',
      rows_calculated: 0,
      rows_inserted: 0,
      rows_updated: 0,
      rows_deleted: 0,
      calculation_version: VERSION,
      started_at: new Date(),
      finished_at: new Date(),
      errors: [err instanceof Error ? err.message : String(err)],
    })
  }

  return results
}

/**
 * Verify refresh idempotency: running twice should produce identical results
 */
export async function testRefreshIdempotency(
  admin: AdminClient,
  orgId: string
): Promise<{ idempotent: boolean; evidence: string[] }> {
  const evidence: string[] = []

  // Run 1
  const run1 = await refreshFinancialAnalytics(admin, orgId)
  const counts1 = run1.reduce(
    (acc, r) => ({ ...acc, [r.phase]: r.rows_inserted }),
    {} as Record<string, number>
  )
  evidence.push(`RUN 1: ${JSON.stringify(counts1)}`)

  // Wait briefly
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Run 2
  const run2 = await refreshFinancialAnalytics(admin, orgId)
  const counts2 = run2.reduce(
    (acc, r) => ({ ...acc, [r.phase]: r.rows_inserted }),
    {} as Record<string, number>
  )
  evidence.push(`RUN 2: ${JSON.stringify(counts2)}`)

  // Compare
  const idempotent = JSON.stringify(counts1) === JSON.stringify(counts2)
  evidence.push(`IDEMPOTENT: ${idempotent}`)

  return { idempotent, evidence }
}
