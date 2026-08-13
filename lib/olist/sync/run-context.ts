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
    .insert({ org_id: orgId, integration, status: 'running' })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to start sync run: ${error?.message ?? 'unknown error'}`)
  }

  return data.id as string
}

export async function finishSyncRun(runId: string, result: SyncRunResult): Promise<void> {
  const admin = createAdminSupabaseClient()
  const { error } = await admin
    .from('sync_runs')
    .update({
      status: result.status,
      finished_at: new Date().toISOString(),
      records_received: result.recordsReceived,
      records_created: result.recordsCreated,
      records_updated: result.recordsUpdated,
      error_count: result.errorCount,
      error_message: result.errorMessage ?? null,
    })
    .eq('id', runId)

  if (error) {
    throw new Error(`Failed to finish sync run ${runId}: ${error.message}`)
  }
}
