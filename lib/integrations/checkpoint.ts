import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export function incrementalSince(lastSuccess: string | null): Date | undefined {
  if (!lastSuccess) return undefined // No checkpoint means full recovery, never an invented 24h window.
  const timestamp = Date.parse(lastSuccess)
  if (!Number.isFinite(timestamp)) throw new Error('Invalid synchronization checkpoint')
  return new Date(timestamp - 24 * 60 * 60 * 1000)
}

export async function loadSyncCheckpoint(orgId: string, integration: 'olist' | 'sumup'): Promise<Date | undefined> {
  const { data, error } = await createAdminSupabaseClient().from('sync_runs').select('synced_through, started_at').eq('org_id', orgId).eq('integration', integration).eq('status', 'success').order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('Failed to load synchronization checkpoint')
  return incrementalSince(data?.synced_through ?? data?.started_at ?? null)
}
