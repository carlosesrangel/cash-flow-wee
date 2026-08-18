import { formatBRL } from '@/lib/format/currency'
import type { RevenueVariance } from '@/lib/analytics/engine'

interface Props {
  data: RevenueVariance[]
}

export function VarianceCard({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-sm text-neutral-500">Sem dados de variância (sem forecast).</p>
  }

  return (
    <div className="rounded-lg border bg-white p-6">
      <h3 className="mb-4 text-lg font-medium">Forecast vs Realizado</h3>
      <div className="space-y-3">
        {data.map((month) => {
          const isPositive = month.varianceAbsolute >= 0
          const color = isPositive ? 'text-green-600' : 'text-red-600'
          const bgColor = isPositive ? 'bg-green-50' : 'bg-red-50'

          return (
            <div key={month.month} className={`rounded p-3 ${bgColor}`}>
              <div className="flex items-baseline justify-between gap-2 text-sm mb-2">
                <div className="font-medium">
                  {new Date(month.month).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                </div>
                <div className={`font-bold ${color}`}>
                  {isPositive ? '+' : ''}{month.variancePercentage}%
                </div>
              </div>
              <div className="flex gap-4 text-xs">
                <div>
                  <div className="text-neutral-600">Forecast</div>
                  <div className="font-medium">{formatBRL(month.forecastTotal)}</div>
                </div>
                <div>
                  <div className="text-neutral-600">Realizado</div>
                  <div className="font-medium">{formatBRL(month.realizedTotal)}</div>
                </div>
                <div>
                  <div className="text-neutral-600">Diferença</div>
                  <div className={`font-medium ${color}`}>{formatBRL(month.varianceAbsolute)}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
