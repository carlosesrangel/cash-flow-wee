import Link from 'next/link'
import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { loadScenarios } from '@/lib/forecast/engine'
import { PageHeader } from '@/components/ui/page-header'
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
      <PageHeader
        title="Cenários de Projeção"
        description="Crie e simule diferentes cenários de projeção de fluxo de caixa"
        action={
          <Link href="/planejamento/forecast-vs-realizado" className="text-sm text-primary hover:underline">
            Forecast vs Realizado
          </Link>
        }
      />

      <CenariosContent scenarios={scenarios} canCreate={canCreate} />
    </div>
  )
}
