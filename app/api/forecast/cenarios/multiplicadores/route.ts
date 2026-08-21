import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { updateScenarioMultiplierSchema } from '@/lib/validation/forecast'
import { updateScenarioMultiplier } from '@/lib/forecast/engine'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canCreateScenario(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = updateScenarioMultiplierSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const input = parsed.data

  try {
    await updateScenarioMultiplier(member.orgId, input.scenarioId, input.ano, input.mes, input.percentual)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao salvar' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'forecast_scenario_multiplier_updated',
    entity: 'forecast_scenario_multipliers',
    entity_id: `${input.scenarioId}-${input.ano}-${input.mes}`,
    after: { percentual: input.percentual },
  })
  if (auditError) {
      // Error suppressed
  }

  return NextResponse.json({ ok: true })
}
