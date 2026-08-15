'use client'

import { useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'

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
              <>
                <tr key={day.date} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : day.date)}
                      className="font-medium underline decoration-dotted"
                    >
                      {formatDateOnlyBR(day.date)}
                    </button>
                  </td>
                  <td className="px-3 py-2">{day.saldoInicial != null ? formatBRL(day.saldoInicial) : '—'}</td>
                  <td className="px-3 py-2 text-emerald-700">{formatBRL(totalEntradas)}</td>
                  <td className="px-3 py-2 text-red-700">{formatBRL(totalSaidas)}</td>
                  <td className="px-3 py-2 font-medium">{day.saldoFinal != null ? formatBRL(day.saldoFinal) : '—'}</td>
                </tr>
                {isExpanded && (
                  <tr key={`${day.date}-detail`} className="border-b bg-neutral-50 last:border-0">
                    <td colSpan={5} className="px-3 py-2">
                      {dayEntries.length === 0 ? (
                        <p className="text-neutral-500">Nenhum lançamento neste dia.</p>
                      ) : (
                        <ul className="space-y-1">
                          {dayEntries.map((entry) => (
                            <li key={entry.id} className="flex justify-between">
                              <span>
                                <span>{entry.description ?? entry.sourceId}</span>{' '}
                                <span className="text-neutral-500">
                                  ({entry.origin}, {entry.bucket})
                                </span>
                              </span>
                              <span className={entry.direction === 'entrada' ? 'text-emerald-700' : 'text-red-700'}>
                                {entry.direction === 'entrada' ? '+' : '-'}
                                {formatBRL(entry.amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
