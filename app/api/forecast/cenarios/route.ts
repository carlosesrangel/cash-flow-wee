import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createForecastScenarioSchema } from '@/lib/validation/forecast'
import { createForecastScenario } from '@/lib/forecast/engine'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canCreateScenario(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = createForecastScenarioSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const input = parsed.data

  let scenario
  try {
    scenario = await createForecastScenario(member.orgId, input.name, member.profileId, input.duplicateFromScenarioId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao criar cenário' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: input.duplicateFromScenarioId ? 'forecast_scenario_duplicated' : 'forecast_scenario_created',
    entity: 'forecast_scenarios',
    entity_id: scenario.id,
    after: { name: scenario.name, duplicateFromScenarioId: input.duplicateFromScenarioId ?? null },
  })
  if (auditError) {
    console.error('Failed to write audit_logs for forecast_scenario_created:', auditError.message)
  }

  return NextResponse.json({ ok: true, scenario })
}
