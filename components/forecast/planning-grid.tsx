'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBRL } from '@/lib/format/currency'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

const MONTH_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function monthKey(ano: number, mes: number): string {
  return `${ano}-${mes}`
}

export function PlanningGrid({
  versionId,
  entries,
  canEdit,
}: {
  versionId: string
  entries: MonthlyValue[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [values, setValues] = useState(() => {
    const map = new Map<string, number>()
    for (const entry of entries) map.set(monthKey(entry.ano, entry.mes), entry.value)
    return map
  })
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const years = Array.from(new Set(entries.map((e) => e.ano))).sort((a, b) => a - b)

  async function handleBlur(ano: number, mes: number, raw: string) {
    const receita = Number(raw)
    if (Number.isNaN(receita)) return
    const key = monthKey(ano, mes)
    if (values.get(key) === receita) return

    setPendingKey(key)
    setError(null)
    try {
      const response = await fetch('/api/forecast/entradas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId, ano, mes, receita }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao salvar')
      } else {
        setValues((prev) => new Map(prev).set(key, receita))
        router.refresh()
      }
    } catch {
      setError('Falha ao salvar')
    } finally {
      setPendingKey(null)
    }
  }

  if (years.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum mês planejado ainda nesta versão.</p>
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 font-medium">Ano</th>
              {MONTH_LABEL.map((label) => (
                <th key={label} className="px-3 py-2 text-right font-medium">
                  {label}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {years.map((ano) => {
              const rowValues = MONTH_LABEL.map((_, i) => values.get(monthKey(ano, i + 1)))
              const total = rowValues.reduce((sum: number, v) => sum + (v ?? 0), 0)
              return (
                <tr key={ano} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{ano}</td>
                  {rowValues.map((value, i) => {
                    const mes = i + 1
                    const key = monthKey(ano, mes)
                    if (value === undefined) {
                      return (
                        <td key={key} className="px-3 py-2 text-right text-neutral-300">
                          —
                        </td>
                      )
                    }
                    return (
                      <td key={key} className="px-2 py-1 text-right">
                        {canEdit ? (
                          <input
                            aria-label={`${MONTH_LABEL[i]} ${ano}`}
                            type="number"
                            step="0.01"
                            defaultValue={value}
                            disabled={pendingKey === key}
                            onBlur={(e) => handleBlur(ano, mes, e.target.value)}
                            className="w-24 rounded border px-1 py-1 text-right text-sm"
                          />
                        ) : (
                          formatBRL(value)
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-medium">{formatBRL(total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
