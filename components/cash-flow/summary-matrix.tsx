'use client'

import { useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import type { SummaryMatrix } from '@/lib/cash-flow/summary-matrix'

export function SummaryMatrix({ matrix }: { matrix: SummaryMatrix }) {
  const [activeCell, setActiveCell] = useState<string | null>(null)
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="min-w-max w-full text-left text-sm">
        <thead className="border-b bg-muted/50 text-muted-foreground"><tr><th className="sticky left-0 z-10 min-w-40 bg-muted/50 px-4 py-3 font-medium">Categoria</th>{matrix.columns.map((column) => <th key={column} className="min-w-24 px-3 py-3 text-right font-medium">{column}</th>)}<th className="px-4 py-3 text-right font-medium">Total</th></tr></thead>
        <tbody>
          {matrix.rows.map((row) => <tr key={row.label} className="border-b last:border-0"><th className="sticky left-0 z-10 bg-card px-4 py-3 font-medium">{row.label}</th>{row.values.map((value, index) => { const key = `${row.label}-${index}`; return <td key={key} className="relative px-3 py-3 text-right font-mono tabular-nums"><button type="button" onClick={() => setActiveCell(activeCell === key ? null : key)} className="rounded px-1.5 py-1 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{value ? formatBRL(value) : '—'}</button>{activeCell === key && row.details[index].length > 0 && <div role="tooltip" className="absolute right-0 top-full z-20 mt-1 w-72 whitespace-pre-line rounded-md border bg-popover p-3 text-left text-xs text-popover-foreground shadow-lg">{row.details[index].map((detail) => <div key={`${detail.date}-${detail.amount}-${detail.label}`} className="border-b py-1.5 last:border-0"><p className="font-medium">{detail.label}</p><p>{formatBRL(detail.amount)} · {detail.date}</p>{detail.customer && <p>Cliente: {detail.customer}</p>}{detail.supplier && <p>Fornecedor: {detail.supplier}</p>}{detail.product && <p>Produto: {detail.product}</p>}{detail.installment && <p>Parcela: {detail.installment}</p>}{detail.paymentMethod && <p>Pagamento: {detail.paymentMethod}</p>}{detail.document && <p>Documento: {detail.document}</p>}</div>)}</div>}</td>})}<td className="px-4 py-3 text-right font-mono font-semibold">{formatBRL(row.total)}</td></tr>)}
          <tr className="border-t bg-muted/30 font-semibold"><th className="sticky left-0 bg-muted/30 px-4 py-3">TOTAL SAÍDAS</th>{matrix.totalSaidas.map((value, index) => <td key={index} className="px-3 py-3 text-right font-mono">{formatBRL(value)}</td>)}<td className="px-4 py-3 text-right font-mono">{formatBRL(matrix.totalSaidas.reduce((sum, value) => sum + value, 0))}</td></tr>
          <tr className="bg-primary/5 font-semibold"><th className="sticky left-0 bg-primary/5 px-4 py-3">FLUXO LÍQUIDO</th>{matrix.fluxoLiquido.map((value, index) => <td key={index} className={`px-3 py-3 text-right font-mono ${value < 0 ? 'text-destructive' : 'text-emerald-700'}`}>{formatBRL(value)}</td>)}<td className="px-4 py-3 text-right font-mono">{formatBRL(matrix.fluxoLiquido.reduce((sum, value) => sum + value, 0))}</td></tr>
        </tbody>
      </table>
    </div>
  )
}
