import { refreshFinancialAnalytics } from '@/lib/financial/refresh'
import { syncLedgerFromAllSources } from '@/lib/ledger/populate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

/** Rebuilds the derived financial layers only after a source sync is complete. */
export async function refreshDerivedFinancialData(orgId: string) {
  const analytics = await refreshFinancialAnalytics(createAdminSupabaseClient(), orgId)
  const analyticsErrors = analytics.flatMap((result) => result.errors)
  if (analyticsErrors.length > 0) throw new Error(`Analytics refresh failed: ${analyticsErrors.join('; ')}`)

  const ledger = await syncLedgerFromAllSources(orgId)
  if (!ledger.success) throw new Error(`Ledger refresh failed: ${ledger.error ?? 'unknown error'}`)

  return { analytics, ledger }
}
