import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { updateForecastEntrySchema } from '@/lib/validation/forecast'
import { updateForecastEntry } from '@/lib/forecast/engine'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canEditForecast(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = updateForecastEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const input = parsed.data

  try {
    await updateForecastEntry(member.orgId, input.versionId, input.ano, input.mes, input.receita, member.profileId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao salvar' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'forecast_entry_updated',
    entity: 'forecast_entries',
    entity_id: `${input.versionId}-${input.ano}-${input.mes}`,
    after: { receita: input.receita, cenario: input.cenario ?? null, comentario: input.comentario ?? null },
  })
  if (auditError) {
      // Error suppressed
  }

  return NextResponse.json({ ok: true })
}
