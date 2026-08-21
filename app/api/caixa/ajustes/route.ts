import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { manualCashEntrySchema } from '@/lib/validation/cash-flow'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canManageCashBalance(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = manualCashEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const input = parsed.data

  // The acting user (who must be OWNER_ADMIN — canManageCashBalance) is
  // recorded as the responsible party. There is no UI to attribute a manual
  // entry to a different member in this phase (see plan Task 9 note).
  const { data: created, error: insertError } = await admin
    .from('manual_cash_entries')
    .insert({
      org_id: member.orgId,
      type: input.type,
      description: input.description,
      amount: input.amount,
      entry_date: input.entryDate,
      responsible_profile_id: member.profileId,
      justification: input.justification,
      created_by: member.profileId,
    })
    .select('id')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // The manual entry is already committed at this point, so a failed audit
  // write must not fail the request — but it must not vanish either: an
  // untraceable financial write is exactly what audit_logs exists to prevent.
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'manual_cash_entry_created',
    entity: 'manual_cash_entries',
    entity_id: created.id,
    after: input,
  })
  if (auditError) {
      // Error suppressed
  }

  return NextResponse.json({ ok: true })
}
