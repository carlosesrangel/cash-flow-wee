import 'server-only'
import { randomUUID } from 'node:crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

/** Shared by Actions, API routes and OAuth callbacks, across processes. */
export async function withIntegrationLock<T>(orgId: string, resource: string, seconds: number, work: () => Promise<T>): Promise<T> {
  const admin = createAdminSupabaseClient()
  const owner = randomUUID()
  const { data, error } = await admin.rpc('acquire_integration_lock', { p_org_id: orgId, p_resource: resource, p_owner: owner, p_seconds: seconds })
  if (error) throw new Error(`Integration lock unavailable: ${error.code}`)
  if (!data) throw new Error(`Integration operation already running: ${resource}`)
  try {
    return await work()
  } finally {
    const { error: releaseError } = await admin.from('integration_locks').delete().eq('org_id', orgId).eq('resource', resource).eq('owner', owner)
    if (releaseError) throw new Error('Failed to release integration lock')
  }
}
