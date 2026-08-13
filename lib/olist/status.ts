import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export type OlistConnectionStatus = {
  status: 'desconectado' | 'conectado' | 'precisa_reautorizar'
  connectedAt: string | null
}

export async function getOlistConnectionStatus(orgId: string): Promise<OlistConnectionStatus> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('integration_connections')
    .select('status, connected_at')
    .eq('org_id', orgId)
    .eq('provider', 'olist')
    .single()

  if (!data) {
    return { status: 'desconectado', connectedAt: null }
  }

  return {
    status: data.status as OlistConnectionStatus['status'],
    connectedAt: (data.connected_at as string | null) ?? null,
  }
}
