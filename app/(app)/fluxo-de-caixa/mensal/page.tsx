import { getCurrentMember } from '@/lib/auth/session'
import { buildCashFlowDays } from '@/lib/cash-flow/engine'
import { loadCanonicalCashFlow } from '@/lib/ledger/canonical-cash-flow'
import { loadCanonicalForecastedCashFlowEntries, mergeCashFlowWithForecast } from '@/lib/forecast/projection'
import { loadCashFlowWithPlannedPayments } from '@/lib/cash-flow/with-payments'
import { toLocalDateParam } from '@/lib/integrations/date'
import { PageHeader } from '@/components/ui/page-header'
import { DailyTable } from '@/components/cash-flow/daily-table'
import { ForecastToggle } from '@/components/cash-flow/forecast-toggle'
import { PaymentsToggle } from '@/components/cash-flow/payments-toggle'
import { createServerSupabaseClient } from '@/lib/supabase/server'

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
  const showPayments = payments === 'true'
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : toLocalDateParam(new Date()).slice(0, 7)
  const from = `${month}-01`
  const to = lastDayOfMonth(month)

  const canonicalEntries = showPayments
    ? await loadCashFlowWithPlannedPayments(member.orgId, undefined, true)
    : await loadCanonicalCashFlow(member.orgId)
  const entries = showForecast ? canonicalEntries : canonicalEntries.filter(entry => entry.bucket !== 'projetado')

  const days = await buildCashFlowDays(member.orgId, from, to, entries)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fluxo de Caixa — Mensal"
        description="Visualize o fluxo de caixa mês a mês com opções de forecast e pagamentos planejados"
      />
      <div className="flex flex-wrap items-center gap-4">
        <form className="flex items-center gap-2">
          <label htmlFor="mes" className="text-sm text-neutral-600">
            Mês
          </label>
          <input id="mes" name="mes" type="month" defaultValue={month} className="rounded border px-2 py-1 text-sm" />
          <input type="hidden" name="forecast" value={String(showForecast)} /><input type="hidden" name="payments" value={String(showPayments)} /><button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
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
