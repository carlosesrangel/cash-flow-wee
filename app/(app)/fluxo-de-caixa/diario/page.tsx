import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, buildCashFlowDays } from '@/lib/cash-flow/engine'
import { shiftDateString } from '@/lib/cash-flow/dates'
import { toLocalDateParam } from '@/lib/integrations/date'
import { PageHeader } from '@/components/ui/page-header'
import { DailyTable } from '@/components/cash-flow/daily-table'

export default async function FluxoDeCaixaDiarioPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o fluxo de caixa.</p>
  }

  const today = toLocalDateParam(new Date())
  const from = shiftDateString(today, -30)
  const to = shiftDateString(today, 90)

  const entries = await loadCashFlowEntries(member.orgId)
  const days = await buildCashFlowDays(member.orgId, from, to, entries)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fluxo de Caixa — Diário"
        description={`Período: ${from} a ${to}. Clique em um dia para ver os lançamentos que o compõem.`}
      />
      <DailyTable days={days} entries={entries} />
    </div>
  )
}
