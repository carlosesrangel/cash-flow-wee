import Link from 'next/link'
import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { loadScenarios } from '@/lib/forecast/engine'
import { CenariosContent } from './content'

export default async function CenariosPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para gerenciar cenários.</p>
  }

  const scenarios = await loadScenarios(member.orgId)
  const canCreate = canCreateScenario(member.role)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Cenários de Projeção</h1>
        <Link href="/planejamento/forecast-vs-realizado" className="text-sm text-neutral-600 underline">
          Forecast vs Realizado
        </Link>
      </div>

      <CenariosContent scenarios={scenarios} canCreate={canCreate} />
    </div>
  )
}
