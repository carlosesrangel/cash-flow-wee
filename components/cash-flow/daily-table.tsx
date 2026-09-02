'use client'

import { Fragment, useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'
import { Plus, Minus } from 'lucide-react'

export function DailyTable({ days, entries }: { days: CashFlowDay[]; entries: CashFlowEntry[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (days.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum dado de fluxo de caixa neste período.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-medium">Dia</th>
            <th className="px-3 py-2 font-medium">Saldo inicial</th>
            <th className="px-3 py-2 font-medium">Entradas</th>
            <th className="px-3 py-2 font-medium">Saídas</th>
            <th className="px-3 py-2 font-medium">Saldo final</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const dayEntries = entries.filter((entry) => entry.date === day.date)
            const totalEntradas = day.entradas.realizado + day.entradas.contratado
            const totalSaidas = day.saidas.realizado + day.saidas.contratado
            const isExpanded = expanded === day.date
            return (
              <Fragment key={day.date}>
                <tr className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : day.date)}
                      className="flex items-center gap-2 font-medium hover:text-primary transition-colors"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current">
                        {isExpanded ? <Minus size={12} /> : <Plus size={12} />}
                      </span>
                      {formatDateOnlyBR(day.date)}
                    </button>
                  </td>
                  <td className="px-3 py-2">{day.saldoInicial != null ? formatBRL(day.saldoInicial) : '—'}</td>
                  <td className="px-3 py-2">
                    <div className="space-y-0.5 text-emerald-700">
                      <div>{formatBRL(totalEntradas)}</div>
                      {day.entradas.projetado > 0 && (
                        <div className="text-xs text-emerald-600">+ {formatBRL(day.entradas.projetado)} (proj.)</div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-0.5 text-red-700">
                      <div>{formatBRL(totalSaidas)}</div>
                      {day.saidas.projetado > 0 && (
                        <div className="text-xs text-red-600">+ {formatBRL(day.saidas.projetado)} (proj.)</div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-medium">{day.saldoFinal != null ? formatBRL(day.saldoFinal) : '—'}</td>
                </tr>
                {isExpanded && (
                  <tr className="border-b bg-neutral-50 last:border-0">
                    <td colSpan={5} className="px-3 py-2">
                      {dayEntries.length === 0 ? (
                        <p className="text-neutral-500">Nenhum lançamento neste dia.</p>
                      ) : (
                        <div className="overflow-x-auto"><table className="min-w-[720px] w-full text-xs"><thead className="border-b text-neutral-500"><tr><th className="px-2 py-2 text-left font-medium">Data</th><th className="px-2 py-2 text-left font-medium">Cliente / Fornecedor</th><th className="px-2 py-2 text-left font-medium">Produto / Categoria</th><th className="px-2 py-2 text-left font-medium">Parcela</th><th className="px-2 py-2 text-left font-medium">Meio / Documento</th><th className="px-2 py-2 text-right font-medium">Valor</th></tr></thead><tbody>{dayEntries.map((entry) => <tr key={entry.id} className="border-b last:border-0"><td className="px-2 py-2">{formatDateOnlyBR(entry.date)}</td><td className="px-2 py-2">{entry.direction === 'entrada' ? (entry.customer ?? entry.description ?? '—') : (entry.supplier ?? entry.description ?? '—')}</td><td className="px-2 py-2">{entry.direction === 'entrada' ? (entry.product ?? '—') : (entry.category ?? '—')}</td><td className="px-2 py-2">{entry.installment ?? '—'}</td><td className="px-2 py-2">{entry.direction === 'entrada' ? (entry.paymentMethod ?? '—') : (entry.document ?? '—')}</td><td className={`px-2 py-2 text-right font-mono ${entry.direction === 'entrada' ? 'text-emerald-700' : 'text-red-700'}`}>{entry.direction === 'entrada' ? '+' : '-'}{formatBRL(entry.amount)}</td></tr>)}</tbody></table></div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
