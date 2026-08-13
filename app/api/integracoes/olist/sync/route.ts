import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { runOlistSync } from '@/lib/olist/sync'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

async function hasPriorSuccessfulSync(orgId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('sync_runs')
    .select('id')
    .eq('org_id', orgId)
    .eq('integration', 'olist')
    .eq('status', 'success')
    .limit(1)
    .maybeSingle()

  return Boolean(data)
}

export async function POST() {
  const member = await getCurrentMember()

  if (!member || !canManageIntegrations(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  try {
    const mode = (await hasPriorSuccessfulSync(member.orgId)) ? 'incremental' : 'initial'
    await runOlistSync(member.orgId, mode)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 }
    )
  }
}
