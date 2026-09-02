import { formatBRL } from '@/lib/format/currency'
import type { SalesSummary } from '@/lib/analytics/engine'
import { MetricCard } from '@/components/ui/metric-card'

interface Props {
  summary: SalesSummary
}

export function SalesSummaryCard({ summary }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <MetricCard label="Vendas" value={formatBRL(summary.totalRevenue)} accentColor="navy" />
      <MetricCard label="Preço médio" value={formatBRL(summary.averagePrice)} accentColor="brown" />
      <MetricCard label="Ticket médio" value={formatBRL(summary.averageOrderValue)} accentColor="green" />
      <MetricCard label="Peças por atendimento" value={summary.piecesPerOrder.toFixed(2)} accentColor="brown" />
      <MetricCard label="Clientes" value={summary.clients} accentColor="navy" />
    </div>
  )
}
