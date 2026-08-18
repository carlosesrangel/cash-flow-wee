import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { aggregateByDay, getMinimumProjectedBalance } from '@/lib/cash-flow/aggregate'
import { diffDaysFromToday, shiftDateString } from '@/lib/cash-flow/dates'
import { toLocalDateParam } from '@/lib/integrations/date'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import { CashCurveChart } from '@/components/cash-flow/cash-curve-chart'
import { BalanceForm } from '@/components/cash-flow/balance-form'
import { ManualEntryForm } from '@/components/cash-flow/manual-entry-form'

function MetricCard({
  label,
  value,
  variant = 'default',
  footnote,
}: {
  label: string
  value: string
  variant?: 'default' | 'inflow' | 'outflow' | 'projected'
  footnote?: string
}) {
  const variantStyles = {
    default: 'border-slate-200 bg-gradient-to-br from-slate-50 to-white',
    inflow: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white',
    outflow: 'border-rose-200 bg-gradient-to-br from-rose-50 to-white',
    projected: 'border-blue-200 bg-gradient-to-br from-blue-50 to-white',
  }

  const valueStyles = {
    default: 'text-slate-900',
    inflow: 'text-emerald-700',
    outflow: 'text-rose-700',
    projected: 'text-blue-700',
  }

  const labelStyles = {
    default: 'text-slate-600',
    inflow: 'text-emerald-600',
    outflow: 'text-rose-600',
    projected: 'text-blue-600',
  }

  return (
    <div
      className={`group relative rounded-xl border-2 ${variantStyles[variant]} p-5 shadow-sm transition-all duration-200 hover:shadow-lg hover:border-opacity-60 cursor-default`}
    >
      <p className={`text-sm font-medium ${labelStyles[variant]} mb-3 uppercase tracking-wide`}>{label}</p>
      <p className={`text-3xl font-bold ${valueStyles[variant]} tabular-nums`}>{value}</p>
      {footnote && <p className="text-xs text-slate-500 mt-2 leading-relaxed">{footnote}</p>}
    </div>
  )
}

export default async function VisaoGeralPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver a visão geral.</p>
  }

  const today = toLocalDateParam(new Date())
  const from = shiftDateString(today, -90)
  const to = shiftDateString(today, 90)

  const entries = await loadCashFlowEntries(member.orgId)
  const opening = await resolveOpeningBalance(member.orgId, from, entries)
  const days = aggregateByDay(entries, { from, to }, opening)

  // Independently anchored at "today" (not `from`, which is 90 days in the
  // past) so a snapshot recorded today is picked up immediately, and built
  // purely from resolveOpeningBalance's realizado-only accounting — never
  // the day array's blended saldoInicial, which includes unrealized
  // (contratado) AR/AP and would misrepresent an unconfirmed projection as
  // today's actual balance.
  const currentBalance = await resolveOpeningBalance(member.orgId, shiftDateString(today, 1), entries)
  const saldoAtual = currentBalance?.balance ?? null
  const saldoAtualAsOf = currentBalance?.asOf ?? null

  const next30 = days.filter((d) => d.date >= today && d.date <= shiftDateString(today, 30))
  const entradas30 = next30.reduce((sum, d) => sum + d.entradas.realizado + d.entradas.contratado, 0)
  const saidas30 = next30.reduce((sum, d) => sum + d.saidas.realizado + d.saidas.contratado, 0)
  const saldoEm30 = next30.length > 0 ? next30[next30.length - 1].saldoFinal : null

  const minimum = getMinimumProjectedBalance(days.filter((d) => d.date >= today))

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="max-w-7xl mx-auto">
          <div className="space-y-2 mb-10">
            <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Visão Geral</h1>
            <p className="text-lg text-slate-600">Controle completo do seu fluxo de caixa</p>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <MetricCard
              label="Saldo Atual"
              value={saldoAtual != null ? formatBRL(saldoAtual) : '—'}
              variant="default"
              footnote={
                saldoAtualAsOf && saldoAtualAsOf !== today
                  ? `há ${diffDaysFromToday(today, saldoAtualAsOf)} dia(s)`
                  : 'Atualizado hoje'
              }
            />
            <MetricCard
              label="Entradas (30 dias)"
              value={formatBRL(entradas30)}
              variant="inflow"
              footnote="Próximos 30 dias"
            />
            <MetricCard
              label="Saídas (30 dias)"
              value={formatBRL(saidas30)}
              variant="outflow"
              footnote="Próximos 30 dias"
            />
            <MetricCard
              label="Saldo em 30 dias"
              value={saldoEm30 != null ? formatBRL(saldoEm30) : '—'}
              variant="projected"
              footnote="Projetado"
            />
          </div>

          {/* Alert Section */}
          {minimum && minimum.balance < 0 && (
            <div className="mt-8 rounded-xl border-2 border-rose-300 bg-gradient-to-r from-rose-50 to-red-50 p-6 backdrop-blur-sm">
              <div className="flex items-start gap-4">
                <div className="text-2xl">⚠️</div>
                <div className="flex-1">
                  <h3 className="font-semibold text-rose-900 mb-1">Alerta: Saldo Negativo Projetado</h3>
                  <p className="text-rose-800">
                    O saldo será negativo em <span className="font-bold">{formatDateOnlyBR(minimum.date)}</span> chegando a{' '}
                    <span className="font-bold">{formatBRL(minimum.balance)}</span>. Considere revisar planejamento de pagamentos.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Chart Section */}
          <div className="mt-10 rounded-xl border-2 border-slate-200 bg-white p-8 shadow-sm">
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Curva de Caixa</h2>
                <p className="text-slate-600">Projeção de saldo nos próximos 180 dias</p>
              </div>
              <div className="h-96 w-full">
                <CashCurveChart days={days} />
              </div>
            </div>
          </div>

          {/* Forms Section */}
          {canManageCashBalance(member.role) && (
            <div className="mt-10 space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-6">Administração</h2>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border-2 border-slate-200 bg-white p-8 shadow-sm">
                  <BalanceForm />
                </div>
                <div className="rounded-xl border-2 border-slate-200 bg-white p-8 shadow-sm">
                  <ManualEntryForm />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
