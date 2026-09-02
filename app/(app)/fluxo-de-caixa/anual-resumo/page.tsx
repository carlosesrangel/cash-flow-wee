import { getCurrentMember } from '@/lib/auth/session'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { loadSummaryMatrix } from '@/lib/cash-flow/summary-matrix'
import { SummaryMatrix } from '@/components/cash-flow/summary-matrix'
import { toLocalDateParam } from '@/lib/integrations/date'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function AnualResumoPage({ searchParams }: { searchParams: Promise<{ ano?: string }> }) {
  const member = await getCurrentMember()
  if (!member) return <EmptyState title="Acesso negado" description="Faça login para ver o resumo anual." />
  const params = await searchParams
  const current = toLocalDateParam(new Date()).slice(0, 4)
  const year = params.ano && /^\d{4}$/.test(params.ano) ? params.ano : current
  const matrix = await loadSummaryMatrix(member.orgId, 'year', year, await createServerSupabaseClient())
  return <div className="space-y-6"><PageHeader title="Anual - Resumo" description="Composição mensal de entradas e saídas do ano selecionado." /><form className="flex items-center gap-2"><label htmlFor="ano-resumo" className="text-sm font-medium">Ano</label><input id="ano-resumo" name="ano" type="number" defaultValue={year} className="w-28 rounded-md border bg-background px-3 py-2 text-sm" /><button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Ver resumo</button></form><SummaryMatrix matrix={matrix} /></div>
}
