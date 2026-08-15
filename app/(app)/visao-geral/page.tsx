import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { aggregateByDay, getMinimumProjectedBalance } from '@/lib/cash-flow/aggregate'
import { shiftDateString } from '@/lib/cash-flow/dates'
import { toLocalDateParam } from '@/lib/integrations/date'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import { CashCurveChart } from '@/components/cash-flow/cash-curve-chart'
import { BalanceForm } from '@/components/cash-flow/balance-form'
import { ManualEntryForm } from '@/components/cash-flow/manual-entry-form'

export default async function VisaoGeralPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver a visão geral.</p>
  }

  const today = toLocalDateParam(new Date())
  const from = shiftDateString(today, -90)
  const to = shiftDateString(today, 90)

  const [entries, opening] = await Promise.all([
    loadCashFlowEntries(member.orgId),
    resolveOpeningBalance(member.orgId, from),
  ])
  const days = aggregateByDay(entries, { from, to }, opening)

  const todayIndex = days.findIndex((d) => d.date === today)
  const saldoAtual = todayIndex >= 0 ? days[todayIndex].saldoInicial : null

  const next30 = days.filter((d) => d.date >= today && d.date <= shiftDateString(today, 30))
  const entradas30 = next30.reduce((sum, d) => sum + d.entradas.realizado + d.entradas.contratado, 0)
  const saidas30 = next30.reduce((sum, d) => sum + d.saidas.realizado + d.saidas.contratado, 0)
  const saldoEm30 = next30.length > 0 ? next30[next30.length - 1].saldoFinal : null

  const minimum = getMinimumProjectedBalance(days.filter((d) => d.date >= today))

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Visão Geral</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Saldo de Caixa Atual</p>
          <p className="text-lg font-semibold">{saldoAtual != null ? formatBRL(saldoAtual) : '—'}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Entradas próximos 30 dias</p>
          <p className="text-lg font-semibold text-emerald-700">{formatBRL(entradas30)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Saídas próximos 30 dias</p>
          <p className="text-lg font-semibold text-red-700">{formatBRL(saidas30)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Saldo projetado em 30 dias</p>
          <p className="text-lg font-semibold">{saldoEm30 != null ? formatBRL(saldoEm30) : '—'}</p>
        </div>
      </div>

      {minimum && minimum.balance < 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Alerta: o saldo projetado fica negativo ({formatBRL(minimum.balance)}) em {formatDateOnlyBR(minimum.date)}.
        </div>
      )}

      <div className="rounded-lg border bg-white p-4">
        <p className="mb-2 text-sm font-medium text-neutral-700">Curva de Caixa</p>
        <CashCurveChart days={days} />
      </div>

      {canManageCashBalance(member.role) && (
        <div className="space-y-3">
          <BalanceForm />
          <ManualEntryForm />
        </div>
      )}
    </div>
  )
}
