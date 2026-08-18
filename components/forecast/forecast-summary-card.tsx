import { formatBRL } from '@/lib/format/currency'
import type { CashFlowMonth } from '@/lib/cash-flow/aggregate'

export function ForecastSummaryCard({ months, title = 'Entrada de Caixa Projetada' }: { months: CashFlowMonth[]; title?: string }) {
  const totalProjetado = months.reduce((sum, m) => sum + m.entradas.projetado, 0)
  const totalRealizado = months.reduce((sum, m) => sum + m.entradas.realizado, 0)
  const faltando = totalProjetado - totalRealizado

  return (
    <div className="rounded-lg border bg-white p-6">
      <h3 className="mb-4 text-sm font-semibold text-neutral-600">{title}</h3>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-neutral-600">Planejado</p>
          <p className="text-lg font-bold text-neutral-900">{formatBRL(totalProjetado)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-600">Realizado</p>
          <p className="text-lg font-bold text-emerald-700">{formatBRL(totalRealizado)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-600">Faltando</p>
          <p className={`text-lg font-bold ${faltando >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{formatBRL(faltando)}</p>
        </div>
      </div>
    </div>
  )
}
