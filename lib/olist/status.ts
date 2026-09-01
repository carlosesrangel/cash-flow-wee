import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export type OlistConnectionStatus = {
  status: 'desconectado' | 'conectado' | 'precisa_reautorizar'
  connectedAt: string | null
  lastSyncAt: string | null
  lastSyncStatus: 'success' | 'failed' | 'running' | null
  payableCategories: { categorized: number; total: number; coveragePct: number }
}

export async function getOlistConnectionStatus(orgId: string): Promise<OlistConnectionStatus> {
  const admin = createAdminSupabaseClient()
  const [{ data }, { data: syncRuns }, { count: total }, { count: categorized }] = await Promise.all([
    admin.from('integration_connections').select('status, connected_at').eq('org_id', orgId).eq('provider', 'olist').maybeSingle(),
    admin.from('sync_runs').select('status, started_at, finished_at').eq('org_id', orgId).eq('integration', 'olist').order('started_at', { ascending: false }).limit(20),
    admin.from('olist_accounts_payable').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    admin.from('olist_accounts_payable').select('id', { count: 'exact', head: true }).eq('org_id', orgId).not('categoria', 'is', null).neq('categoria', ''),
  ])

  const payableCategories = {
    categorized: categorized ?? 0,
    total: total ?? 0,
    coveragePct: total ? ((categorized ?? 0) / total) * 100 : 100,
  }

  if (!data) {
    return { status: 'desconectado', connectedAt: null, lastSyncAt: null, lastSyncStatus: null, payableCategories }
  }

  const cutoff = Date.now() - 10 * 60 * 1000
  const activeRun = (syncRuns ?? []).find((run) => run.status === 'running' && new Date(run.started_at).getTime() >= cutoff)
  const lastFinished = (syncRuns ?? []).find((run) => run.status !== 'running' && run.finished_at)

  return {
    status: data.status as OlistConnectionStatus['status'],
    connectedAt: (data.connected_at as string | null) ?? null,
    lastSyncAt: activeRun?.started_at ?? lastFinished?.finished_at ?? null,
    lastSyncStatus: activeRun ? 'running' : (lastFinished?.status as 'success' | 'failed' | undefined) ?? null,
    payableCategories,
  }
}
