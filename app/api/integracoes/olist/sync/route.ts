import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { runOlistSync } from '@/lib/olist/sync'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ACTIVE_SYNC_STALENESS_MS = 10 * 60 * 1000

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

// Guards against two overlapping sync runs for the same org, which could otherwise
// interleave delete+insert cycles on olist_order_items and leave duplicate rows
// (there's no unique constraint on that table and each order's items are re-inserted,
// not upserted). A run is only considered "active" if it started recently — a crashed
// or killed process leaves a stale `running` row that must not permanently deadlock
// future syncs.
async function hasActiveSyncRun(orgId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient()
  const cutoff = new Date(Date.now() - ACTIVE_SYNC_STALENESS_MS).toISOString()
  const { data } = await admin
    .from('sync_runs')
    .select('id')
    .eq('org_id', orgId)
    .eq('integration', 'olist')
    .eq('status', 'running')
    .gte('started_at', cutoff)
    .limit(1)
    .maybeSingle()

  return Boolean(data)
}

export async function POST() {
  const member = await getCurrentMember()

  if (!member || !canManageIntegrations(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  if (await hasActiveSyncRun(member.orgId)) {
    return NextResponse.json({ error: 'Sincronização já em andamento' }, { status: 409 })
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
