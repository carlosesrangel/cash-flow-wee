import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { loadForecastedCashFlowEntries, mergeCashFlowWithForecast } from '@/lib/forecast/projection'
import { loadCashFlowWithPlannedPayments } from '@/lib/cash-flow/with-payments'
import { aggregateByDay, aggregateByMonth } from '@/lib/cash-flow/aggregate'
import { toLocalDateParam } from '@/lib/integrations/date'
import { AnnualTable } from '@/components/cash-flow/annual-table'
import { ForecastToggle } from '@/components/cash-flow/forecast-toggle'
import { PaymentsToggle } from '@/components/cash-flow/payments-toggle'

export default async function FluxoDeCaixaAnualPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string; forecast?: string; payments?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o fluxo de caixa.</p>
  }

  const { ano, forecast, payments } = await searchParams
  const showForecast = forecast !== 'false'
  const showPayments = payments !== 'false'
  const currentYear = Number(toLocalDateParam(new Date()).slice(0, 4))
  const year = ano && /^\d{4}$/.test(ano) ? Number(ano) : currentYear
  const from = `${year}-01-01`
  const to = `${year}-12-31`

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
  const months = aggregateByMonth(days)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fluxo de Caixa — Anual</h1>
      <div className="flex flex-wrap items-center gap-4">
        <form className="flex items-center gap-2">
          <label htmlFor="ano" className="text-sm text-neutral-600">
            Ano
          </label>
          <input id="ano" name="ano" type="number" defaultValue={year} className="w-24 rounded border px-2 py-1 text-sm" />
          <button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
            Ver
          </button>
        </form>
        <ForecastToggle />
        <PaymentsToggle />
      </div>
      <AnnualTable months={months} />
    </div>
  )
}
