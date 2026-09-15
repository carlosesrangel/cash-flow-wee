import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageUsers } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { inviteMemberSchema } from '@/lib/validation/auth'
import { getInvitationRedirectUrl } from '@/lib/auth/invitation'

export async function POST(request: Request) {
  const member = await getCurrentMember()
  if (!member || !canManageUsers(member.role)) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  const parsed = inviteMemberSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Convite inválido' }, { status: 400 })

  const admin = createAdminSupabaseClient()
  const { data: invitation, error: invitationError } = await admin.from('organization_invitations').insert({ org_id: member.orgId, email: parsed.data.email.toLowerCase(), role: parsed.data.role, invited_by: member.profileId }).select('id, email, role, status, invited_at, expires_at').single()
  if (invitationError) return NextResponse.json({ error: invitationError.message }, { status: 409 })

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    redirectTo: getInvitationRedirectUrl(request),
  })
  if (inviteError || !invited.user) {
    await admin.from('organization_invitations').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', invitation.id)
    return NextResponse.json({ error: inviteError?.message ?? 'Falha ao enviar convite' }, { status: 502 })
  }

  const { data: linkedInvitation, error: linkError } = await admin
    .from('organization_invitations')
    .update({ auth_user_id: invited.user.id, updated_at: new Date().toISOString() })
    .eq('id', invitation.id)
    .eq('status', 'pending')
    .select('id, email, role, status, invited_at, expires_at')
    .single()

  if (linkError || !linkedInvitation) {
    await admin.from('organization_invitations').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', invitation.id).eq('status', 'pending')
    return NextResponse.json({ error: linkError?.message ?? 'Falha ao registrar convite' }, { status: 500 })
  }

  // Membership is created only after the invited user confirms the invite.
  // The callback completes membership + invitation status in one database RPC.
  return NextResponse.json({ invitation: linkedInvitation }, { status: 201 })
}
