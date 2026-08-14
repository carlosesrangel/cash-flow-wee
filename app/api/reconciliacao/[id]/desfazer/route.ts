import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function POST(_request: Request, ctx: RouteContext<'/api/reconciliacao/[id]/desfazer'>) {
  const member = await getCurrentMember()

  if (!member || !canManageReconciliation(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const { id } = await ctx.params
  const admin = createAdminSupabaseClient()

  const { data: match, error: matchError } = await admin
    .from('reconciliation_matches')
    .select('id')
    .eq('id', id)
    .eq('org_id', member.orgId)
    .maybeSingle()

  if (matchError) {
    return NextResponse.json({ error: matchError.message }, { status: 500 })
  }
  if (!match) {
    return NextResponse.json({ error: 'Registro de reconciliação não encontrado' }, { status: 404 })
  }

  const { error: updateError } = await admin
    .from('reconciliation_matches')
    .update({
      status: 'nao_reconciliado',
      sumup_transaction_event_id: null,
      sumup_transaction_id: null,
      resolved_by: null,
      resolved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', member.orgId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
