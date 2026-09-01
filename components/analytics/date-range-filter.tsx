'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export interface DateRange {
  startDate: Date
  endDate: Date
  days?: number
}

interface DateRangeFilterProps {
  onRangeChange: (range: DateRange) => void
  loading?: boolean
}

const PRESET_RANGES = ['Ontem', 'Essa semana', 'Esse mês', 'Esse ano', 'Ano anterior'] as const

export function DateRangeFilter({ onRangeChange, loading }: DateRangeFilterProps) {
  const [selectedRange, setSelectedRange] = useState<string>('Esse mês')
  const [customMode, setCustomMode] = useState(false)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  const applyPreset = (preset: typeof PRESET_RANGES[number]) => {
    setSelectedRange(preset)
    setCustomMode(false)
    const today = new Date()
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    let start = new Date(end)
    let rangeEnd = new Date(end)
    if (preset === 'Ontem') { start.setDate(start.getDate() - 1); rangeEnd = new Date(start) }
    if (preset === 'Essa semana') { const day = start.getDay(); const mondayOffset = day === 0 ? 6 : day - 1; start.setDate(start.getDate() - mondayOffset) }
    if (preset === 'Esse mês') start = new Date(end.getFullYear(), end.getMonth(), 1)
    if (preset === 'Esse ano') start = new Date(end.getFullYear(), 0, 1)
    if (preset === 'Ano anterior') { start = new Date(end.getFullYear() - 1, 0, 1); rangeEnd = new Date(end.getFullYear() - 1, 11, 31) }
    onRangeChange({ startDate: start, endDate: rangeEnd, days: Math.ceil((rangeEnd.getTime() - start.getTime()) / 86400000) + 1 })
  }

  const applyCustomRange = () => {
    if (!startDate || !endDate) {
      alert('Por favor, selecione data de início e fim')
      return
    }

    const start = new Date(startDate)
    const end = new Date(endDate)

    if (start > end) {
      alert('Data de início não pode ser maior que data de fim')
      return
    }

    setSelectedRange('custom')
    onRangeChange({
      startDate: start,
      endDate: end,
    })
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Preset Buttons */}
          <div>
            <p className="mb-3 text-sm font-medium text-slate-700">Períodos Pré-definidos</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_RANGES.map((preset) => (
                <Button
                  key={preset}
                  onClick={() => applyPreset(preset)}
                  variant={selectedRange === preset && !customMode ? 'default' : 'outline'}
                  size="sm"
                  disabled={loading}
                  className="text-xs"
                >
                  {preset}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom Range */}
          <div className="border-t border-slate-200 pt-4">
            <p className="mb-3 text-sm font-medium text-slate-700">Intervalo Personalizado</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Data Inicial
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={loading}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Data Final
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={loading}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <Button
                onClick={applyCustomRange}
                variant="default"
                size="sm"
                disabled={loading}
                className="w-full sm:w-auto"
              >
                Aplicar
              </Button>
            </div>
          </div>

          {/* Info */}
          <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 border border-blue-200">
            <p className="font-medium">💡 Dica:</p>
            <p>Use os períodos pré-definidos para análises rápidas ou personalize o intervalo para períodos específicos.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
