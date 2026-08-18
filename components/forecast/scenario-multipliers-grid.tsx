'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MonthlyValue } from '@/lib/forecast/scenarios'
import type { ForecastScenario } from '@/lib/forecast/engine'

const MONTH_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function monthKey(ano: number, mes: number): string {
  return `${ano}-${mes}`
}

function formatPercentual(value: number | undefined): string {
  if (value === undefined) return '—'
  return `${Math.round(value * 100)}%`
}

export function ScenarioMultipliersGrid({
  scenario,
  multipliers,
  canEdit,
}: {
  scenario: ForecastScenario
  multipliers: MonthlyValue[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [values, setValues] = useState(() => {
    const map = new Map<string, number>()
    for (const mult of multipliers) {
      map.set(monthKey(mult.ano, mult.mes), mult.value)
    }
    return map
  })
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const years = Array.from(new Set(multipliers.map((m) => m.ano))).sort((a, b) => a - b)

  async function handleBlur(ano: number, mes: number, raw: string) {
    const percentual = Number(raw) / 100
    if (Number.isNaN(percentual) || percentual < 0) return
    const key = monthKey(ano, mes)
    if (values.get(key) === percentual) return

    setPendingKey(key)
    setError(null)
    try {
      const response = await fetch('/api/forecast/cenarios/multiplicadores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: scenario.id, ano, mes, percentual }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao salvar')
      } else {
        setValues((prev) => new Map(prev).set(key, percentual))
        router.refresh()
      }
    } catch {
      setError('Falha ao salvar')
    } finally {
      setPendingKey(null)
    }
  }

  if (years.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum multiplicador configurado para este cenário.</p>
  }

  return (
    <div className="space-y-2">
      <h3 className="font-medium text-neutral-900">{scenario.name}</h3>
      {error && <div className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}
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
              <th className="px-3 py-2 text-right font-medium">Médio</th>
            </tr>
          </thead>
          <tbody>
            {years.map((ano) => {
              const rowValues = MONTH_LABEL.map((_, i) => values.get(monthKey(ano, i + 1)))
              const avgValue = rowValues.filter((v) => v !== undefined).reduce((a: number, b) => a + (b ?? 0), 0) / rowValues.filter((v) => v !== undefined).length
              return (
                <tr key={ano} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{ano}</td>
                  {rowValues.map((value, i) => {
                    const mes = i + 1
                    const key = monthKey(ano, mes)
                    const displayValue = value !== undefined ? Math.round(value * 100) : ''
                    return (
                      <td key={key} className="px-2 py-1 text-right">
                        {canEdit ? (
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            defaultValue={displayValue}
                            disabled={pendingKey === key}
                            onBlur={(e) => handleBlur(ano, mes, e.target.value)}
                            className="w-full border-0 bg-transparent text-right font-mono text-sm text-neutral-900 disabled:text-neutral-400 focus:rounded focus:border focus:bg-white focus:px-1 focus:outline-none"
                          />
                        ) : (
                          formatPercentual(value)
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-medium">{Number.isNaN(avgValue) ? '—' : `${Math.round(avgValue * 100)}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
