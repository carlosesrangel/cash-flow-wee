import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageUsers } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

async function loadOwner() {
  const member = await getCurrentMember()
  return member && canManageUsers(member.role) ? member : null
}

export async function POST(_request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const member = await loadOwner()
  if (!member) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  const { invitationId } = await params
  const admin = createAdminSupabaseClient()
  const { data: invitation } = await admin.from('organization_invitations').select('id, email, role, status').eq('id', invitationId).eq('org_id', member.orgId).maybeSingle()
  if (!invitation || invitation.status !== 'pending') return NextResponse.json({ error: 'Convite não encontrado ou já encerrado' }, { status: 404 })
  const { error } = await admin.auth.admin.inviteUserByEmail(invitation.email)
  if (error) return NextResponse.json({ error: error.message }, { status: 502 })
  const { data } = await admin.from('organization_invitations').update({ invited_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), updated_at: new Date().toISOString() }).eq('id', invitationId).eq('org_id', member.orgId).select('id, email, role, status, invited_at, expires_at').single()
  return NextResponse.json({ invitation: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const member = await loadOwner()
  if (!member) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  const { invitationId } = await params
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from('organization_invitations').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', invitationId).eq('org_id', member.orgId).eq('status', 'pending')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
