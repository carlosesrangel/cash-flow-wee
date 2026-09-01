#!/usr/bin/env node
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { refreshDerivedFinancialData } from '@/lib/sync/derived-refresh'

const WINDOW_MS = 6 * 60 * 60 * 1000
const ACTIVE_MS = 10 * 60 * 1000

async function main() {
  const admin = createAdminSupabaseClient()
  const orgIndex = process.argv.indexOf('--org')
  const requestedOrgId = orgIndex >= 0 ? process.argv[orgIndex + 1] : undefined
  const force = process.argv.includes('--force')
  const { data: recentSourceRuns, error } = await admin.from('sync_runs').select('org_id').gte('started_at', new Date(Date.now() - WINDOW_MS).toISOString())
  if (error) throw error
  const orgIds = requestedOrgId ? [requestedOrgId] : [...new Set((recentSourceRuns ?? []).map((run) => run.org_id))]
  let refreshed = 0

  for (const orgId of orgIds) {
    const since = new Date(Date.now() - WINDOW_MS).toISOString()
    const [{ data: recentRuns }, { data: activeRun }] = await Promise.all([
      admin.from('sync_runs').select('integration, status, finished_at').eq('org_id', orgId).gte('started_at', since).order('started_at', { ascending: false }),
      admin.from('sync_runs').select('id').eq('org_id', orgId).eq('status', 'running').gte('started_at', new Date(Date.now() - ACTIVE_MS).toISOString()).limit(1).maybeSingle(),
    ])
    if (!force && activeRun) continue
    if (!force && !(recentRuns ?? []).some((run) => run.status === 'success')) continue

    const sourceFinished = new Map<string, string>()
    for (const run of recentRuns ?? []) {
      if (run.status === 'success' && run.finished_at && !sourceFinished.has(run.integration)) sourceFinished.set(run.integration, run.finished_at)
    }
    if (force) {
      const { data: latestSuccessfulRuns } = await admin.from('sync_runs').select('integration, finished_at').eq('org_id', orgId).eq('status', 'success').order('finished_at', { ascending: false }).limit(20)
      for (const run of latestSuccessfulRuns ?? []) {
        if (run.finished_at && !sourceFinished.has(run.integration)) sourceFinished.set(run.integration, run.finished_at)
      }
    }
    console.log(`Refreshing derived financial data for ${orgId}`)
    const result = await refreshDerivedFinancialData(orgId)
    const analyticsFinishedAt = result.analytics.reduce<Date | null>((latest, item) => !latest || item.finished_at > latest ? item.finished_at : latest, null)
    const ledgerFinishedAt = new Date()
    await admin.from('financial_refresh_runs').insert({
      org_id: orgId,
      olist_finished_at: sourceFinished.get('olist') ?? null,
      sumup_finished_at: sourceFinished.get('sumup') ?? null,
      analytics_finished_at: analyticsFinishedAt?.toISOString() ?? new Date().toISOString(),
      ledger_finished_at: ledgerFinishedAt.toISOString(),
      calculation_version: 'FINANCIAL_MODEL_V2_EXCEL_PARITY',
    })
    refreshed += 1
  }

  console.log(`FINANCIAL_REFRESH_COMPLETED=${refreshed}`)
}

main().catch((error) => {
  console.error('Financial refresh failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
