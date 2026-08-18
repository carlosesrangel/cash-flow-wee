import { formatBRL } from '@/lib/format/currency'
import type { MonthlyRevenue } from '@/lib/analytics/engine'

interface Props {
  data: MonthlyRevenue[]
}

export function MonthlyRevenueCard({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-neutral-500">Sem dados de receita mensais.</p>
  }

  const maxRevenue = Math.max(...data.map((d) => d.total))

  return (
    <div className="rounded-lg border bg-white p-6">
      <h3 className="mb-4 text-lg font-medium">Receita Mensal</h3>
      <div className="space-y-3">
        {data.map((month) => {
          const percentage = (month.total / maxRevenue) * 100
          const realPercent = (month.realized / month.total) * 100

          return (
            <div key={month.month}>
              <div className="flex items-baseline justify-between gap-2 text-sm mb-2">
                <div className="font-medium">{new Date(month.month).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</div>
                <div className="text-right">
                  <div className="font-bold">{formatBRL(month.total)}</div>
                  <div className="text-xs text-neutral-500">{month.invoiceCount} faturas</div>
                </div>
              </div>
              <div className="h-6 overflow-hidden rounded bg-neutral-100">
                <div
                  className="flex h-full"
                  style={{
                    width: `${percentage}%`,
                  }}
                >
                  <div className="bg-green-500" style={{ width: `${realPercent}%` }} />
                  <div className="bg-yellow-300" style={{ width: `${100 - realPercent}%` }} />
                </div>
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {formatBRL(month.realized)} realizado • {formatBRL(month.pending)} pendente
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
