import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { loadForecastedCashFlowEntries, mergeCashFlowWithForecast } from '@/lib/forecast/projection'
import { loadCashFlowWithPlannedPayments } from '@/lib/cash-flow/with-payments'
import { aggregateByDay } from '@/lib/cash-flow/aggregate'
import { toLocalDateParam } from '@/lib/integrations/date'
import { DailyTable } from '@/components/cash-flow/daily-table'
import { ForecastToggle } from '@/components/cash-flow/forecast-toggle'
import { PaymentsToggle } from '@/components/cash-flow/payments-toggle'

function lastDayOfMonth(month: string): string {
  const [year, monthNum] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

export default async function FluxoDeCaixaMensalPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; forecast?: string; payments?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o fluxo de caixa.</p>
  }

  const { mes, forecast, payments } = await searchParams
  const showForecast = forecast !== 'false'
  const showPayments = payments !== 'false'
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : toLocalDateParam(new Date()).slice(0, 7)
  const from = `${month}-01`
  const to = lastDayOfMonth(month)

  const actualEntries = await loadCashFlowEntries(member.orgId)

  let entries = actualEntries
  if (showForecast) {
    const forecastEntries = await loadForecastedCashFlowEntries(member.orgId)
    const now = new Date()
    const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const today = { ano: brazilTime.getFullYear(), mes: brazilTime.getMonth() + 1 }
    entries = mergeCashFlowWithForecast(actualEntries, forecastEntries, today)
  }

  if (showPayments) {
    entries = await loadCashFlowWithPlannedPayments(member.orgId, undefined, true)
    // Merge with forecast if both enabled
    if (showForecast) {
      const forecastEntries = await loadForecastedCashFlowEntries(member.orgId)
      const now = new Date()
      const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
      const today = { ano: brazilTime.getFullYear(), mes: brazilTime.getMonth() + 1 }
      entries = mergeCashFlowWithForecast(entries, forecastEntries, today)
    }
  }

  const opening = await resolveOpeningBalance(member.orgId, from, entries)
  const days = aggregateByDay(entries, { from, to }, opening)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fluxo de Caixa — Mensal</h1>
      <div className="flex flex-wrap items-center gap-4">
        <form className="flex items-center gap-2">
          <label htmlFor="mes" className="text-sm text-neutral-600">
            Mês
          </label>
          <input id="mes" name="mes" type="month" defaultValue={month} className="rounded border px-2 py-1 text-sm" />
          <button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
            Ver
          </button>
        </form>
        <ForecastToggle />
        <PaymentsToggle />
      </div>
      <DailyTable days={days} entries={entries} />
    </div>
  )
}
