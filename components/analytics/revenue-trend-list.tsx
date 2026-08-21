import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { DailyRevenuePoint } from '@/lib/analytics/engine'

interface Props {
  data: DailyRevenuePoint[]
}

export function RevenueTrendList({ data }: Props) {
  // Filter out days without revenue
  const daysWithRevenue = data.filter((d) => d.revenue > 0)

  if (daysWithRevenue.length === 0) {
    return <p className="text-sm text-neutral-500">Sem dados de receita nos últimos 90 dias.</p>
  }

  const total = daysWithRevenue.reduce((sum, d) => sum + d.revenue, 0)
  const avgDaily = daysWithRevenue.length > 0 ? total / daysWithRevenue.length : 0

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-4 rounded-lg border bg-neutral-50 p-4">
        <div>
          <div className="text-xs text-neutral-500">Total (com venda)</div>
          <div className="text-xl font-bold">{formatBRL(total)}</div>
        </div>
        <div>
          <div className="text-xs text-neutral-500">Média Diária ({daysWithRevenue.length} dias)</div>
          <div className="text-xl font-bold">{formatBRL(avgDaily)}</div>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border bg-white p-4">
        <div className="grid grid-cols-4 gap-2 text-xs font-medium text-neutral-600">
          <div>Data</div>
          <div className="text-right">Receita</div>
          <div className="text-right">Transações</div>
          <div className="text-right">Clientes</div>
        </div>
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {daysWithRevenue.slice(0, 30).map((point) => (
            <div key={point.date} className="grid grid-cols-4 gap-2 text-sm text-neutral-600">
              <div>{formatDateOnlyBR(point.date)}</div>
              <div className="text-right font-medium">{formatBRL(point.revenue)}</div>
              <div className="text-right">{point.transactions}</div>
              <div className="text-right">{point.customers}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
