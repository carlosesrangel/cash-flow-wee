import Link from 'next/link'
import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadCanonicalPlan, loadScenarioConfig } from '@/lib/planning/canonical-repository'
import { PageHeader } from '@/components/ui/page-header'
import { CenariosContent } from './content'

export default async function CenariosPage() {
  const member = await getCurrentMember()
  if (!member) return <p className="text-sm text-neutral-500">Faça login para gerenciar cenários.</p>
  const client = await createServerSupabaseClient()
  const [plans, config] = await Promise.all([loadCanonicalPlan(member.orgId, '2024-01-01', '2030-12-01', client), loadScenarioConfig(member.orgId, client)])
  return <div className="space-y-6"><PageHeader title="Cenários de Projeção" description="Simule conservador e otimista sem duplicar nem modificar o plano base" action={<Link href="/planejamento" className="text-sm text-primary hover:underline">Abrir planejamento</Link>} /><CenariosContent plans={plans} config={config} canEdit={canCreateScenario(member.role)} now={new Date().toISOString()} /></div>
}
