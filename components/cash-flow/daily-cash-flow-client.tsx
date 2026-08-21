'use client'

import { useMemo, useState } from 'react'
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'
import type { CashFlowEntry, CashBucket } from '@/lib/cash-flow/engine'
import { DailyTable } from '@/components/cash-flow/daily-table'
import { PeriodFilter } from '@/components/filters/period-filter'

export function DailyCashFlowClient({
  days,
  entries,
}: {
  days: CashFlowDay[]
  entries: CashFlowEntry[]
}) {
  const [selectedBuckets, setSelectedBuckets] = useState<Set<CashBucket>>(
    new Set(['realizado', 'contratado', 'projetado'])
  )

  const bucketOptions: CashBucket[] = ['realizado', 'contratado', 'projetado']

  // Filter entries based on selected buckets
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => selectedBuckets.has(entry.bucket))
  }, [entries, selectedBuckets])

  // Recalculate days based on filtered entries
  const filteredDays = useMemo(() => {
    if (filteredEntries.length === 0) return days.map(d => ({
      ...d,
      entradas: { realizado: 0, contratado: 0, projetado: 0 },
      saidas: { realizado: 0, contratado: 0, projetado: 0 },
      saldoInicial: null,
      saldoFinal: null,
    }))

    const dayMap = new Map<string, CashFlowDay>()
    for (const day of days) {
      dayMap.set(day.date, { ...day })
    }

    // Reset entries and recalculate
    const result = new Map<string, CashFlowDay>()
    for (const entry of filteredEntries) {
      const day = result.get(entry.date) ?? {
        date: entry.date,
        saldoInicial: dayMap.get(entry.date)?.saldoInicial ?? null,
        saldoFinal: null,
        entradas: { realizado: 0, contratado: 0, projetado: 0 },
        saidas: { realizado: 0, contratado: 0, projetado: 0 },
      }

      if (entry.direction === 'entrada') {
        day.entradas[entry.bucket] += entry.amount
      } else {
        day.saidas[entry.bucket] += entry.amount
      }

      result.set(entry.date, day)
    }

    // Recalculate running balance
    let balance = dayMap.get(days[0].date)?.saldoInicial ?? 0
    const sorted = Array.from(result.entries())
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([_, day]) => {
        const totalEntradas = day.entradas.realizado + day.entradas.contratado + day.entradas.projetado
        const totalSaidas = day.saidas.realizado + day.saidas.contratado + day.saidas.projetado
        balance += totalEntradas - totalSaidas
        return {
          ...day,
          saldoInicial: dayMap.get(day.date)?.saldoInicial ?? null,
          saldoFinal: balance,
        }
      })

    return sorted
  }, [days, filteredEntries])

  const toggleBucket = (bucket: CashBucket) => {
    const newSet = new Set(selectedBuckets)
    if (newSet.has(bucket)) {
      newSet.delete(bucket)
    } else {
      newSet.add(bucket)
    }
    setSelectedBuckets(newSet)
  }

  return (
    <div className="space-y-4">
      <PeriodFilter />

      {/* Bucket Filters */}
      <div className="space-y-2 rounded-lg border bg-white p-4">
        <p className="text-sm font-medium text-neutral-600">Tipo de Lançamento</p>
        <div className="flex flex-wrap gap-2">
          {bucketOptions.map((bucket) => (
            <button
              key={bucket}
              onClick={() => toggleBucket(bucket)}
              className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                selectedBuckets.has(bucket)
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {bucket === 'realizado' && '✓ Realizado'}
              {bucket === 'contratado' && '📋 Contratado'}
              {bucket === 'projetado' && '🔮 Projetado'}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-500 mt-2">
          {filteredEntries.length} lançamento(s) selecionado(s)
        </p>
      </div>

      <DailyTable days={filteredDays} entries={filteredEntries} />
    </div>
  )
}
