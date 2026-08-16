import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { aggregateByDay } from '@/lib/cash-flow/aggregate'
import { shiftDateString } from '@/lib/cash-flow/dates'
import { toLocalDateParam } from '@/lib/integrations/date'
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
  const opening = await resolveOpeningBalance(member.orgId, from, entries)
  const days = aggregateByDay(entries, { from, to }, opening)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fluxo de Caixa — Diário</h1>
      <p className="text-sm text-neutral-500">
        Período: {from} a {to}. Clique em um dia para ver os lançamentos que o compõem.
      </p>
      <DailyTable days={days} entries={entries} />
    </div>
  )
}
