'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface PeriodFilterProps {
  onPeriodChange?: (startDate: string, endDate: string) => void
}

/**
 * Standardized period filter component for dashboard pages.
 * Uses URL search params: ?from=2026-08-01&to=2026-08-31
 *
 * Default: last 30 days from today
 */
export function PeriodFilter({ onPeriodChange }: PeriodFilterProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const today = new Date()
  const defaultFrom = new Date(today)
  defaultFrom.setDate(today.getDate() - 30)

  const fromParam = searchParams.get('from') ?? defaultFrom.toISOString().split('T')[0]
  const toParam = searchParams.get('to') ?? today.toISOString().split('T')[0]

  const presets = [
    { label: 'Últimos 7 dias', days: 7 },
    { label: 'Últimos 30 dias', days: 30 },
    { label: 'Este mês', custom: 'this-month' },
    { label: 'Mês anterior', custom: 'last-month' },
    { label: 'Últimos 3 meses', days: 90 },
  ]

  function applyPreset(days?: number, custom?: string) {
    let from: Date, to: Date

    if (custom === 'this-month') {
      const now = new Date()
      from = new Date(now.getFullYear(), now.getMonth(), 1)
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    } else if (custom === 'last-month') {
      const now = new Date()
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      to = new Date(now.getFullYear(), now.getMonth(), 0)
    } else {
      to = new Date()
      from = new Date(to)
      from.setDate(to.getDate() - (days ?? 30))
    }

    const fromStr = from.toISOString().split('T')[0]
    const toStr = to.toISOString().split('T')[0]

    const params = new URLSearchParams()
    params.set('from', fromStr)
    params.set('to', toStr)

    router.push(`?${params.toString()}`)
    onPeriodChange?.(fromStr, toStr)
  }

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>, type: 'from' | 'to') {
    const params = new URLSearchParams(searchParams)
    if (type === 'from') {
      params.set('from', e.target.value)
    } else {
      params.set('to', e.target.value)
    }
    router.push(`?${params.toString()}`)
    const fromVal = type === 'from' ? e.target.value : searchParams.get('from') ?? fromParam
    const toVal = type === 'to' ? e.target.value : searchParams.get('to') ?? toParam
    onPeriodChange?.(fromVal, toVal)
  }

  return (
    <div className="space-y-3 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.label}
            onClick={() => applyPreset(preset.days, preset.custom)}
            className="rounded bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-200 transition-colors"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label htmlFor="period-from" className="block text-xs font-medium text-neutral-600 mb-1">
            De
          </label>
          <input
            id="period-from"
            type="date"
            value={fromParam}
            onChange={(e) => handleCustomChange(e, 'from')}
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="period-to" className="block text-xs font-medium text-neutral-600 mb-1">
            Até
          </label>
          <input
            id="period-to"
            type="date"
            value={toParam}
            onChange={(e) => handleCustomChange(e, 'to')}
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
      </div>
    </div>
  )
}
