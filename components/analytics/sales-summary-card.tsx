import { formatBRL } from '@/lib/format/currency'
import type { SalesSummary } from '@/lib/analytics/engine'

interface Props {
  summary: SalesSummary
}

export function SalesSummaryCard({ summary }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
      <div className="rounded-lg border bg-white p-4">
        <div className="text-xs text-neutral-500">Receita Anual</div>
        <div className="mt-2 text-2xl font-bold">{formatBRL(summary.totalRevenue)}</div>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="text-xs text-neutral-500">Receita (Mês)</div>
        <div className="mt-2 text-2xl font-bold">{formatBRL(summary.monthlyRevenue)}</div>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="text-xs text-neutral-500">Nota Média</div>
        <div className="mt-2 text-2xl font-bold">{formatBRL(summary.averageOrderValue)}</div>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="text-xs text-neutral-500">Faturas (Mês)</div>
        <div className="mt-2 text-2xl font-bold">{summary.invoicesThisMonth}</div>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="text-xs text-neutral-500">Clientes Top</div>
        <div className="mt-2 text-2xl font-bold">{summary.topCustomersCount}</div>
      </div>
    </div>
  )
}
