import { formatBRL } from '@/lib/format/currency'
import type { CashFlowMonth } from '@/lib/cash-flow/aggregate'

const MONTH_LABEL = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

function formatMonth(month: string): string {
  const [, monthNum] = month.split('-')
  return MONTH_LABEL[Number(monthNum) - 1] ?? month
}

export function AnnualTable({ months }: { months: CashFlowMonth[] }) {
  if (months.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum dado de fluxo de caixa neste período.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-medium">Mês</th>
            <th className="px-3 py-2 font-medium">Entradas</th>
            <th className="px-3 py-2 font-medium">Saídas</th>
            <th className="px-3 py-2 font-medium">Resultado</th>
            <th className="px-3 py-2 font-medium">Saldo final</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => {
            const totalEntradas = month.entradas.realizado + month.entradas.contratado
            const totalSaidas = month.saidas.realizado + month.saidas.contratado
            const resultado = totalEntradas - totalSaidas
            return (
              <tr key={month.month} className="border-b last:border-0">
                <td className="px-3 py-2">{formatMonth(month.month)}</td>
                <td className="px-3 py-2 text-emerald-700">{formatBRL(totalEntradas)}</td>
                <td className="px-3 py-2 text-red-700">{formatBRL(totalSaidas)}</td>
                <td className={`px-3 py-2 font-medium ${resultado < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {formatBRL(resultado)}
                </td>
                <td className="px-3 py-2 font-medium">{month.saldoFinal != null ? formatBRL(month.saldoFinal) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
