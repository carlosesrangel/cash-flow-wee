import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { cashBalanceSnapshotSchema } from '@/lib/validation/cash-flow'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canManageCashBalance(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = cashBalanceSnapshotSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const input = parsed.data

  const { data: snapshot, error: insertError } = await admin
    .from('cash_balance_snapshots')
    .insert({
      org_id: member.orgId,
      reference_date: input.referenceDate,
      bank_balance: input.bankBalance,
      cash_on_hand: input.cashOnHand ?? null,
      liquid_investments: input.liquidInvestments ?? null,
      notes: input.notes ?? null,
      created_by: member.profileId,
    })
    .select('id')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // The snapshot is already committed at this point, so a failed audit write
  // must not fail the request — but it must not vanish either: an untraceable
  // financial write is exactly what audit_logs exists to prevent.
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'cash_balance_snapshot_created',
    entity: 'cash_balance_snapshots',
    entity_id: snapshot.id,
    after: input,
  })
  if (auditError) {
    console.error('Failed to write audit_logs for cash_balance_snapshot_created:', auditError.message)
  }

  return NextResponse.json({ ok: true })
}
