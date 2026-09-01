import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageUsers } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function GET() {
  const member = await getCurrentMember()
  if (!member || !canManageUsers(member.role)) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })

  const admin = createAdminSupabaseClient()
  const [{ data: members, error: memberError }, { data: invitations, error: invitationError }] = await Promise.all([
    admin.from('organization_members').select('id, profile_id, role, active, created_at').eq('org_id', member.orgId).order('created_at'),
    admin.from('organization_invitations').select('id, email, role, status, invited_at, expires_at').eq('org_id', member.orgId).order('invited_at', { ascending: false }),
  ])
  if (memberError || invitationError) return NextResponse.json({ error: 'Falha ao carregar usuários' }, { status: 500 })

  const profileIds = (members ?? []).map((row) => row.profile_id)
  const { data: profiles } = profileIds.length ? await admin.from('profiles').select('id, full_name').in('id', profileIds) : { data: [] }
  return NextResponse.json({
    members: (members ?? []).map((row) => ({ ...row, full_name: profiles?.find((profile) => profile.id === row.profile_id)?.full_name ?? null })),
    invitations: invitations ?? [],
  })
}
