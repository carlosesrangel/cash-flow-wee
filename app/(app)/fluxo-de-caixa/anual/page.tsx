import { getCurrentMember } from '@/lib/auth/session'
import { buildCashFlowDays } from '@/lib/cash-flow/engine'
import { loadCanonicalCashFlow } from '@/lib/ledger/canonical-cash-flow'
import { loadCanonicalForecastedCashFlowEntries, mergeCashFlowWithForecast } from '@/lib/forecast/projection'
import { loadCashFlowWithPlannedPayments } from '@/lib/cash-flow/with-payments'
import { aggregateByMonth } from '@/lib/cash-flow/aggregate'
import { toLocalDateParam } from '@/lib/integrations/date'
import { PageHeader } from '@/components/ui/page-header'
import { AnnualTable } from '@/components/cash-flow/annual-table'
import { ForecastToggle } from '@/components/cash-flow/forecast-toggle'
import { PaymentsToggle } from '@/components/cash-flow/payments-toggle'
import { createServerSupabaseClient } from '@/lib/supabase/server'

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
  const showPayments = payments === 'true'
  const currentYear = Number(toLocalDateParam(new Date()).slice(0, 4))
  const year = ano && /^\d{4}$/.test(ano) ? Number(ano) : currentYear
  const from = `${year}-01-01`
  const to = `${year}-12-31`

  const canonicalEntries = showPayments
    ? await loadCashFlowWithPlannedPayments(member.orgId, undefined, true)
    : await loadCanonicalCashFlow(member.orgId)
  const entries = showForecast ? canonicalEntries : canonicalEntries.filter(entry => entry.bucket !== 'projetado')

  const days = await buildCashFlowDays(member.orgId, from, to, entries)
  const months = aggregateByMonth(days)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fluxo de Caixa — Anual"
        description="Visualize o fluxo de caixa ano a ano com opções de forecast e pagamentos planejados"
      />
      <div className="flex flex-wrap items-center gap-4">
        <form className="flex items-center gap-2">
          <label htmlFor="ano" className="text-sm text-neutral-600">
            Ano
          </label>
          <input id="ano" name="ano" type="number" defaultValue={year} className="w-24 rounded border px-2 py-1 text-sm" />
          <input type="hidden" name="forecast" value={String(showForecast)} /><input type="hidden" name="payments" value={String(showPayments)} /><button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
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
