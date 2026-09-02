import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { loadSystemHealth } from '@/lib/observability/system-health'

export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  try {
    return NextResponse.json(await loadSystemHealth(member.orgId))
  } catch {
    return NextResponse.json({ error: 'Falha ao carregar saúde do sistema' }, { status: 500 })
  }
}
