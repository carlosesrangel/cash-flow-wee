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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KPITile label="Vendas" value={formatBRL(summary.totalRevenue)} emoji="📊" />
      <KPITile label="Peças" value={summary.pieces} emoji="📦" />
      <KPITile label="Preço médio" value={formatBRL(summary.averagePrice)} emoji="🏷️" />
      <KPITile label="Ticket Médio" value={formatBRL(summary.averageOrderValue)} emoji="💰" />
      <KPITile label="Peças por atendimento" value={summary.piecesPerOrder.toFixed(2)} emoji="🧾" />
      <KPITile label="Clientes" value={summary.clients} emoji="👥" />
    </div>
  )
}
