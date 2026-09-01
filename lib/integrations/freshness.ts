import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export type IntegrationFreshness = {
  lastOlistSync: string | null
  olistStatus: 'success' | 'failed' | 'running' | null
  lastSumupSync: string | null
  sumupStatus: 'success' | 'failed' | 'running' | null
  lastAnalyticsRefresh: string | null
  lastLedgerRefresh: string | null
}

export async function loadIntegrationFreshness(orgId: string): Promise<IntegrationFreshness> {
  const admin = createAdminSupabaseClient()
  const [olist, sumup, analytics, ledger, refreshRun] = await Promise.all([
    admin.from('sync_runs').select('status, started_at, finished_at').eq('org_id', orgId).eq('integration', 'olist').order('started_at', { ascending: false }).limit(20),
    admin.from('sync_runs').select('status, started_at, finished_at').eq('org_id', orgId).eq('integration', 'sumup').order('started_at', { ascending: false }).limit(20),
    admin.from('sumup_fee_rates_12m').select('calculado_em').eq('org_id', orgId).order('calculado_em', { ascending: false }).limit(1).maybeSingle(),
    admin.from('financial_ledger').select('created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('financial_refresh_runs').select('analytics_finished_at, ledger_finished_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  if ([olist, sumup, analytics, ledger, refreshRun].some((query) => query.error)) throw new Error('Failed to load integration freshness')

  const latest = (runs: { status: string; started_at: string; finished_at: string | null }[] | null) => {
    const cutoff = Date.now() - 10 * 60 * 1000
    const active = (runs ?? []).find((run) => run.status === 'running' && new Date(run.started_at).getTime() >= cutoff)
    const finished = (runs ?? []).find((run) => run.status !== 'running' && run.finished_at)
    return {
      status: active ? 'running' as const : (finished?.status as 'success' | 'failed' | undefined) ?? null,
      timestamp: active?.started_at ?? finished?.finished_at ?? null,
    }
  }

  const olistLatest = latest(olist.data)
  const sumupLatest = latest(sumup.data)
  return {
    lastOlistSync: olistLatest.timestamp,
    olistStatus: olistLatest.status,
    lastSumupSync: sumupLatest.timestamp,
    sumupStatus: sumupLatest.status,
    lastAnalyticsRefresh: refreshRun.data?.analytics_finished_at ?? analytics.data?.calculado_em ?? null,
    lastLedgerRefresh: refreshRun.data?.ledger_finished_at ?? ledger.data?.created_at ?? null,
  }
}
