import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { buildAuthorizeUrl } from '@/lib/olist/oauth'

export async function GET() {
  const member = await getCurrentMember()

  if (!member || !canManageIntegrations(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  return NextResponse.redirect(buildAuthorizeUrl(member.orgId))
}
