import { paymentPeriodSchema } from '@/lib/payments/period'
import { loadCanonicalCashFlow } from '@/lib/ledger/canonical-cash-flow'
import { getCurrentMember } from '@/lib/auth/session'
import { buildCashFlowDays } from '@/lib/cash-flow/engine'
import { shiftDateString } from '@/lib/cash-flow/dates'
import { toLocalDateParam } from '@/lib/integrations/date'
import { PageHeader } from '@/components/ui/page-header'
import { DailyCashFlowClient } from '@/components/cash-flow/daily-cash-flow-client'

export default async function FluxoDeCaixaDiarioPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; buckets?: string }> }) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o fluxo de caixa.</p>
  }

  const today = toLocalDateParam(new Date())
  const params = await searchParams
  const from = params.from || shiftDateString(today, -30)
  const to = params.to || today
  if (!paymentPeriodSchema.safeParse({ from, to }).success) return <p role="alert">Per?odo inv?lido.</p>

  const buckets = params.buckets === undefined ? ['realizado', 'contratado', 'projetado'] : params.buckets.split(',')
  const entries = (await loadCanonicalCashFlow(member.orgId)).filter(e => buckets.includes(e.bucket))
  const days = await buildCashFlowDays(member.orgId, from, to, entries)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fluxo de Caixa — Diário"
        description="Visualize o fluxo de caixa diário com filtros de realizado, contratado e projetado."
      />
      <DailyCashFlowClient days={days} entries={entries} />
    </div>
  )
}
