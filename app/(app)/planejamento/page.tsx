import Link from 'next/link'
import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadCanonicalPlan } from '@/lib/planning/canonical-repository'
import { toLocalDateParam } from '@/lib/integrations/date'
import { PageHeader } from '@/components/ui/page-header'
import { CanonicalPlanGrid } from '@/components/planning/canonical-plan-grid'

export default async function PlanejamentoPage() {
  const member = await getCurrentMember()
  if (!member) return <p className="text-sm text-neutral-500">Faça login para ver o planejamento.</p>
  const client = await createServerSupabaseClient()
  const plans = await loadCanonicalPlan(member.orgId, '2024-01-01', '2030-12-01', client)
  const now = new Date()
  return <div className="space-y-6"><PageHeader title="Planejamento de Receita" description="Plano mensal único, auditável e protegido por competência. Os cenários são simulações virtuais." action={<Link href="/cenarios" className="text-sm text-primary hover:underline">Configurar cenários</Link>} />{plans.length === 0 && <div className="rounded-lg border border-dashed bg-muted/20 p-5 text-sm text-muted-foreground">Nenhuma linha factual foi importada ainda. Execute o importador com <code>planejado wee.xlsx</code>; este módulo não inventa valores ausentes.</div>}<CanonicalPlanGrid plans={plans} canEdit={canEditForecast(member.role)} now={now.toISOString()} /><p className="text-xs text-muted-foreground">Data local de referência: {toLocalDateParam(now)} · Competências até o mês atual permanecem somente leitura.</p></div>
}
