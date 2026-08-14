import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function POST(request: Request, ctx: RouteContext<'/api/reconciliacao/[id]/confirmar'>) {
  const member = await getCurrentMember()

  if (!member || !canManageReconciliation(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const sumupTransactionEventId = (body as { sumupTransactionEventId?: unknown } | null)?.sumupTransactionEventId

  if (typeof sumupTransactionEventId !== 'string' || sumupTransactionEventId.length === 0) {
    return NextResponse.json({ error: 'sumupTransactionEventId é obrigatório' }, { status: 400 })
  }

  const { id } = await ctx.params
  const admin = createAdminSupabaseClient()

  const { data: match, error: matchError } = await admin
    .from('reconciliation_matches')
    .select('id, candidate_ids, status')
    .eq('id', id)
    .eq('org_id', member.orgId)
    .maybeSingle()

  if (matchError) {
    return NextResponse.json({ error: matchError.message }, { status: 500 })
  }
  if (!match) {
    return NextResponse.json({ error: 'Registro de reconciliação não encontrado' }, { status: 404 })
  }
  if (match.status !== 'conflito') {
    return NextResponse.json(
      { error: 'Só é possível confirmar um candidato quando o status é conflito' },
      { status: 409 }
    )
  }

  const candidateIds = Array.isArray(match.candidate_ids) ? (match.candidate_ids as string[]) : []
  if (!candidateIds.includes(sumupTransactionEventId)) {
    return NextResponse.json(
      { error: 'sumupTransactionEventId não é um candidato válido para este registro' },
      { status: 400 }
    )
  }

  const { data: event, error: eventError } = await admin
    .from('sumup_transaction_events')
    .select('id, transaction_id')
    .eq('id', sumupTransactionEventId)
    .eq('org_id', member.orgId)
    .maybeSingle()

  if (eventError || !event) {
    return NextResponse.json({ error: 'Evento SumUp não encontrado' }, { status: 404 })
  }

  const { error: updateError } = await admin
    .from('reconciliation_matches')
    .update({
      status: 'reconciliado_manualmente',
      sumup_transaction_event_id: event.id,
      sumup_transaction_id: event.transaction_id,
      resolved_by: member.profileId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', member.orgId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
