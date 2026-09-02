import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadCanonicalPlan, updateCanonicalPlan } from '@/lib/planning/canonical-repository'

export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const client = await createServerSupabaseClient()
  const plans = await loadCanonicalPlan(member.orgId, undefined, undefined, client)
  return NextResponse.json({ plans })
}

export async function PATCH(request: Request) {
  const member = await getCurrentMember()
  if (!member || !canEditForecast(member.role)) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  const body = await request.json().catch(() => null) as { competenceMonth?: unknown; amount?: unknown } | null
  const competenceMonth = typeof body?.competenceMonth === 'string' ? body.competenceMonth : ''
  const amount = typeof body?.amount === 'number' ? body.amount : Number(body?.amount)
  try {
    const client = await createServerSupabaseClient()
    const result = await updateCanonicalPlan(client, member.orgId, competenceMonth, amount, member.profileId)
    const { error: auditError } = await client.from('plan_audit_log').insert({ org_id: member.orgId, competence_month: competenceMonth, previous_amount: result.previousAmount, new_amount: result.amount, actor_profile_id: member.profileId })
    if (auditError) throw new Error(`Falha ao registrar auditoria: ${auditError.message}`)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao salvar o plano' }, { status: 400 })
  }
}
