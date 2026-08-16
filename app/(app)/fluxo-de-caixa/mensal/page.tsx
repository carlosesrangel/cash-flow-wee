import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { aggregateByDay } from '@/lib/cash-flow/aggregate'
import { toLocalDateParam } from '@/lib/integrations/date'
import { DailyTable } from '@/components/cash-flow/daily-table'

function lastDayOfMonth(month: string): string {
  const [year, monthNum] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

export default async function FluxoDeCaixaMensalPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o fluxo de caixa.</p>
  }

  const { mes } = await searchParams
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : toLocalDateParam(new Date()).slice(0, 7)
  const from = `${month}-01`
  const to = lastDayOfMonth(month)

  const entries = await loadCashFlowEntries(member.orgId)
  const opening = await resolveOpeningBalance(member.orgId, from, entries)
  const days = aggregateByDay(entries, { from, to }, opening)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fluxo de Caixa — Mensal</h1>
      <form className="flex items-center gap-2">
        <label htmlFor="mes" className="text-sm text-neutral-600">
          Mês
        </label>
        <input id="mes" name="mes" type="month" defaultValue={month} className="rounded border px-2 py-1 text-sm" />
        <button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
          Ver
        </button>
      </form>
      <DailyTable days={days} entries={entries} />
    </div>
  )
}
