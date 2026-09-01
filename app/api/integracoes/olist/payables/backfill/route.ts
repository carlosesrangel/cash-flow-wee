import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { backfillPayableCategories } from '@/lib/olist/sync/payable-category-backfill'

export const maxDuration = 300

export async function POST(request: Request) {
  const member = await getCurrentMember()
  if (!member || !canManageIntegrations(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const url = new URL(request.url)
  const watermark = url.searchParams.get('watermark') ?? undefined
  const result = await backfillPayableCategories(member.orgId, { watermark })
  return NextResponse.json({ ok: result.errors.length === 0, ...result }, { status: result.errors.length === 0 ? 200 : 207 })
}
