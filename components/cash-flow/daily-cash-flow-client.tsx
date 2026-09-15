'use client'

import { useRouter, useSearchParams } from 'next/navigation'
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
  const router = useRouter()
  const params = useSearchParams()
  const bucketOptions: CashBucket[] = ['realizado', 'contratado', 'projetado']
  const selectedBuckets = new Set(params.has('buckets') ? params.get('buckets')!.split(',') : bucketOptions)
  const toggleBucket = (bucket: CashBucket) => {
    const next = new Set(selectedBuckets)
    if (next.has(bucket)) next.delete(bucket); else next.add(bucket)
    const query = new URLSearchParams(params)
    query.set('buckets', [...next].join(','))
    router.replace(`?${query.toString()}`, { scroll: false })
  }
  const filteredEntries = entries
  const filteredDays = days

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
