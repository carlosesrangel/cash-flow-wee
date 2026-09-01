import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageUsers } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { organizationRoleSchema } from '@/lib/validation/auth'

async function owner() {
  const member = await getCurrentMember()
  return member && canManageUsers(member.role) ? member : null
}

export async function PATCH(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const member = await owner()
  if (!member) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  const body = await request.json().catch(() => null)
  const role = body?.role === undefined ? undefined : organizationRoleSchema.safeParse(body.role)
  if (role && !role.success) return NextResponse.json({ error: 'Role inválida' }, { status: 400 })
  const { memberId } = await params
  const update: { role?: string; active?: boolean } = {}
  if (role) update.role = role.data
  if (typeof body?.active === 'boolean') update.active = body.active
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nenhuma alteração informada' }, { status: 400 })

  const admin = createAdminSupabaseClient()
  const { data: target } = await admin.from('organization_members').select('id, profile_id, role, active').eq('id', memberId).eq('org_id', member.orgId).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 })
  if (target.profile_id === member.profileId && update.active === false) return NextResponse.json({ error: 'Não é possível desativar o próprio acesso' }, { status: 400 })
  if (target.role === 'OWNER_ADMIN' && (update.active === false || update.role && update.role !== 'OWNER_ADMIN')) {
    const { count } = await admin.from('organization_members').select('id', { count: 'exact', head: true }).eq('org_id', member.orgId).eq('role', 'OWNER_ADMIN').eq('active', true)
    if ((count ?? 0) <= 1) return NextResponse.json({ error: 'A organização precisa manter um administrador ativo' }, { status: 400 })
  }
  const { data, error } = await admin.from('organization_members').update(update).eq('id', memberId).eq('org_id', member.orgId).select('id, profile_id, role, active').maybeSingle()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Membro não encontrado' }, { status: error ? 500 : 404 })
  return NextResponse.json({ member: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const member = await owner()
  if (!member) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  const { memberId } = await params
  const admin = createAdminSupabaseClient()
  const { data: target } = await admin.from('organization_members').select('profile_id, role, active').eq('id', memberId).eq('org_id', member.orgId).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 })
  if (target.profile_id === member.profileId) return NextResponse.json({ error: 'Não é possível remover o próprio acesso' }, { status: 400 })
  if (target.role === 'OWNER_ADMIN' && target.active) {
    const { count } = await admin.from('organization_members').select('id', { count: 'exact', head: true }).eq('org_id', member.orgId).eq('role', 'OWNER_ADMIN').eq('active', true)
    if ((count ?? 0) <= 1) return NextResponse.json({ error: 'A organização precisa manter um administrador ativo' }, { status: 400 })
  }
  const { error } = await admin.from('organization_members').delete().eq('id', memberId).eq('org_id', member.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
