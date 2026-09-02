import { getCurrentMember } from '@/lib/auth/session'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { loadSummaryMatrix } from '@/lib/cash-flow/summary-matrix'
import { SummaryMatrix } from '@/components/cash-flow/summary-matrix'
import { toLocalDateParam } from '@/lib/integrations/date'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function MensalResumoPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const member = await getCurrentMember()
  if (!member) return <EmptyState title="Acesso negado" description="Faça login para ver o resumo mensal." />
  const params = await searchParams
  const current = toLocalDateParam(new Date()).slice(0, 7)
  const month = params.mes && /^\d{4}-\d{2}$/.test(params.mes) ? params.mes : current
  const matrix = await loadSummaryMatrix(member.orgId, 'month', month, await createServerSupabaseClient())
  return <div className="space-y-6"><PageHeader title="Mensal - Resumo" description="Composição diária de entradas e saídas do mês selecionado." /><form className="flex items-center gap-2"><label htmlFor="mes-resumo" className="text-sm font-medium">Mês</label><input id="mes-resumo" name="mes" type="month" defaultValue={month} className="rounded-md border bg-background px-3 py-2 text-sm" /><button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Ver resumo</button></form><SummaryMatrix matrix={matrix} /></div>
}
