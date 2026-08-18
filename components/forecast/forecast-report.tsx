import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { ForecastVsRealizadoRow } from '@/lib/forecast/compare'

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function formatPercentual(value: number | null): string {
  if (value === null) return '—'
  const pct = Math.round(value * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

export function ForecastReport({ rows }: { rows: ForecastVsRealizadoRow[] }) {
  if (!rows || rows.length === 0) {
    return <div className="text-sm text-neutral-500">Nenhum dado disponível para este relatório.</div>
  }

  const groupedByYear = new Map<number, ForecastVsRealizadoRow[]>()
  for (const row of rows) {
    if (!groupedByYear.has(row.ano)) {
      groupedByYear.set(row.ano, [])
    }
    groupedByYear.get(row.ano)!.push(row)
  }

  return (
    <div className="space-y-6">
      {Array.from(groupedByYear.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([year, yearRows]) => (
          <div key={year} className="space-y-2">
            <h3 className="font-semibold text-neutral-900">{year}</h3>
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-neutral-50 text-neutral-600">
                  <tr>
                    <th className="px-4 py-2 font-medium">Mês</th>
                    <th className="px-4 py-2 text-right font-medium">Planejado</th>
                    <th className="px-4 py-2 text-right font-medium">Realizado</th>
                    <th className="px-4 py-2 text-right font-medium">Diferença</th>
                    <th className="px-4 py-2 text-right font-medium">% Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {yearRows
                    .sort((a, b) => a.mes - b.mes)
                    .map((row) => (
                      <tr key={`${row.ano}-${row.mes}`} className="border-b last:border-0">
                        <td className="px-4 py-2 font-medium text-neutral-900">{MONTH_NAMES[row.mes - 1]}</td>
                        <td className="px-4 py-2 text-right font-mono text-neutral-900">{formatBRL(row.planejado)}</td>
                        <td className={`px-4 py-2 text-right font-mono ${row.realizado === null ? 'text-neutral-400' : 'text-neutral-900'}`}>
                          {row.realizado === null ? '—' : formatBRL(row.realizado)}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono ${row.diferencaAbsoluta === null ? 'text-neutral-400' : row.diferencaAbsoluta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {row.diferencaAbsoluta === null ? '—' : formatBRL(row.diferencaAbsoluta)}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono ${row.diferencaPercentual === null ? 'text-neutral-400' : row.diferencaPercentual >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatPercentual(row.diferencaPercentual)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  )
}
