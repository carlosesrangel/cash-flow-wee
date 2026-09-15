import { sanitizeIntegrationError } from '@/lib/observability/health'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export type SyncRunResult = {
  status: 'success' | 'failed'
  recordsReceived: number
  // The sync functions upsert in bulk and never actually measured how many
  // rows were newly inserted vs. updated, so these are `null` ("not
  // measured") rather than a fabricated count equal to recordsReceived.
  recordsCreated: number | null
  recordsUpdated: number | null
  errorCount: number
  errorMessage?: string
}

export async function startSyncRun(orgId: string, integration: 'olist' | 'sumup'): Promise<string> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('sync_runs')
    .insert({ org_id: orgId, integration, status: 'running', records_created: 0, records_updated: 0 })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to start sync run: ${error?.message ?? 'unknown error'}`)
  }

  return data.id as string
}

export async function finishSyncRun(runId: string, result: SyncRunResult): Promise<void> {
  const admin = createAdminSupabaseClient()
  const { data: current, error: readError } = await admin.from('sync_runs').select('integration, started_at, records_created, records_updated').eq('id', runId).single()
  if (readError) throw new Error('Failed to read sync metrics')
  const processed = Math.max(result.recordsReceived, Number(current?.records_created ?? 0) + Number(current?.records_updated ?? 0))
  const finishedAt = new Date().toISOString()
  const { error } = await admin
    .from('sync_runs')
    .update({
      status: result.status,
      finished_at: finishedAt,
      synced_through: result.status === 'success' ? current?.started_at : null,
      records_received: processed,
      records_created: result.recordsCreated ?? current?.records_created ?? 0,
      records_updated: result.recordsUpdated ?? current?.records_updated ?? 0,
      error_count: result.errorCount,
      error_message: sanitizeIntegrationError(null, result.errorMessage).message,
    })
    .eq('id', runId)

  console.log(JSON.stringify({ integration: current?.integration, integrationRun: runId, status: result.status, startedAt: current?.started_at, finishedAt, processed, inserted: current?.records_created, updated: current?.records_updated, syncedThrough: result.status === 'success' ? current?.started_at : null }))
  if (error) {
    throw new Error(`Failed to finish sync run ${runId}: ${error.message}`)
  }
}
