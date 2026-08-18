import { formatBRL } from '@/lib/format/currency'
import type { SalesSummary } from '@/lib/analytics/engine'

interface Props {
  summary: SalesSummary
}

function KPITile({ label, value, emoji }: { label: string; value: string | number; emoji: string }) {
  return (
    <div className="group rounded-xl border-2 border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm transition-all duration-200 hover:shadow-lg hover:border-slate-300 cursor-default">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-medium text-slate-600 uppercase tracking-wide">{label}</p>
        <span className="text-2xl">{emoji}</span>
      </div>
      <p className="text-3xl font-bold text-slate-900 tabular-nums">{value}</p>
    </div>
  )
}

export function SalesSummaryCard({ summary }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
      <KPITile label="Receita Anual" value={formatBRL(summary.totalRevenue)} emoji="📊" />
      <KPITile label="Receita (Mês)" value={formatBRL(summary.monthlyRevenue)} emoji="📈" />
      <KPITile label="Ticket Médio" value={formatBRL(summary.averageOrderValue)} emoji="💰" />
      <KPITile label="Faturas (Mês)" value={summary.invoicesThisMonth} emoji="📄" />
      <KPITile label="Clientes Top" value={summary.topCustomersCount} emoji="👥" />
    </div>
  )
}
