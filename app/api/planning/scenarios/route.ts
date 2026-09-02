import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadScenarioConfig, updateScenarioConfig } from '@/lib/planning/canonical-repository'

export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const client = await createServerSupabaseClient()
  return NextResponse.json(await loadScenarioConfig(member.orgId, client))
}

export async function PATCH(request: Request) {
  const member = await getCurrentMember()
  if (!member || !canCreateScenario(member.role)) return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  const body = await request.json().catch(() => null) as { conservativePercent?: unknown; optimisticPercent?: unknown } | null
  const conservativePercent = Number(body?.conservativePercent)
  const optimisticPercent = Number(body?.optimisticPercent)
  try {
    const client = await createServerSupabaseClient()
    await updateScenarioConfig(member.orgId, conservativePercent, optimisticPercent, member.profileId, client)
    return NextResponse.json({ ok: true, conservativePercent, optimisticPercent })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao salvar cenários' }, { status: 400 })
  }
}
