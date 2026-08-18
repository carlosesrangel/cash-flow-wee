import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createForecastVersionSchema } from '@/lib/validation/forecast'
import { createForecastVersion } from '@/lib/forecast/engine'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canEditForecast(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = createForecastVersionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }

  const version = await createForecastVersion(member.orgId, parsed.data.name, member.profileId)

  const admin = createAdminSupabaseClient()
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'forecast_version_created',
    entity: 'forecast_versions',
    entity_id: version.id,
    after: { name: version.name },
  })
  if (auditError) {
    console.error('Failed to write audit_logs for forecast_version_created:', auditError.message)
  }

  return NextResponse.json({ ok: true, version })
}
