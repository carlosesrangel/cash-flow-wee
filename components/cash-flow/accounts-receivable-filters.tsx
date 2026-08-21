'use client'

import { useState, useMemo } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { AccountsReceivableTable, type AccountsReceivableRow } from '@/components/cash-flow/accounts-receivable-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Calendar, X } from 'lucide-react'

type ReceivableStatus = 'realizado' | 'vencido' | '0-7' | '8-15' | '16-30' | '31-60' | '61+' | 'all'

interface FilterState {
  dateFrom: string
  dateTo: string
  status: ReceivableStatus
  client: string
  minValue: number | null
  maxValue: number | null
}

const getDateRange = (preset: string, today: string): [string, string] => {
  const todayDate = new Date(today)
  const weekLater = new Date(todayDate.getTime() + 7 * 24 * 60 * 60 * 1000)
  const thirtyDaysLater = new Date(todayDate.getTime() + 30 * 24 * 60 * 60 * 1000)
  const sixtyDaysLater = new Date(todayDate.getTime() + 60 * 24 * 60 * 60 * 1000)
  const ninetyDaysLater = new Date(todayDate.getTime() + 90 * 24 * 60 * 60 * 1000)

  const dateToString = (d: Date) => d.toISOString().split('T')[0]

  switch (preset) {
    case 'week':
      return [today, dateToString(weekLater)]
    case 'month':
      return [today, dateToString(thirtyDaysLater)]
    case 'sixty':
      return [today, dateToString(sixtyDaysLater)]
    case 'ninety':
      return [today, dateToString(ninetyDaysLater)]
    default:
      return [today, dateToString(sixtyDaysLater)]
  }
}

const getAgingBucket = (daysUntilDue: number): string => {
  if (daysUntilDue < 0) return 'vencido'
  if (daysUntilDue <= 7) return '0-7'
  if (daysUntilDue <= 15) return '8-15'
  if (daysUntilDue <= 30) return '16-30'
  if (daysUntilDue <= 60) return '31-60'
  return '61+'
}

export function AccountsReceivableFilters({
  rows,
  clients,
  today,
}: {
  rows: AccountsReceivableRow[]
  clients: string[]
  today: string
}) {
  const [dateFrom, dateTo] = getDateRange('sixty', today)
  const [filters, setFilters] = useState<FilterState>({
    dateFrom,
    dateTo,
    status: 'all',
    client: '',
    minValue: null,
    maxValue: null,
  })

  const filteredRows = useMemo(() => {
    const todayDate = new Date(today)

    return rows.filter((row) => {
      if (!row.classification.included) return false

      const dueDate = new Date((row.classification as any).date)

      // Date filter
      const dateFromObj = new Date(filters.dateFrom)
      const dateToObj = new Date(filters.dateTo)
      if (dueDate < dateFromObj || dueDate > dateToObj) return false

      // Status filter
      if (filters.status !== 'all') {
        // Check if already received (realizado)
        if (filters.status === 'realizado') {
          if (row.classification.bucket !== 'realizado') return false
        } else {
          // Check aging for pending items
          if (row.classification.bucket !== 'contratado') return false
          const daysUntilDue = Math.ceil((dueDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
          const bucket = getAgingBucket(daysUntilDue)
          if (bucket !== filters.status) return false
        }
      }

      // Client filter
      if (filters.client && row.clienteNome !== filters.client) return false

      // Value filter
      const valor = row.valor ?? 0
      if (filters.minValue !== null && valor < filters.minValue) return false
      if (filters.maxValue !== null && valor > filters.maxValue) return false

      return true
    })
  }, [rows, today, filters])

  const handleDatePreset = (preset: string) => {
    const [newFrom, newTo] = getDateRange(preset, today)
    setFilters((prev) => ({ ...prev, dateFrom: newFrom, dateTo: newTo }))
  }

  const handleReset = () => {
    const [newFrom, newTo] = getDateRange('sixty', today)
    setFilters({
      dateFrom: newFrom,
      dateTo: newTo,
      status: 'all',
      client: '',
      minValue: null,
      maxValue: null,
    })
  }

  const hasActiveFilters =
    filters.status !== 'all' || filters.client || filters.minValue || filters.maxValue

  const statusLabels: Record<ReceivableStatus, string> = {
    all: 'Todos',
    realizado: '✓ Recebido',
    vencido: '⚠️ Vencido',
    '0-7': '0-7 dias',
    '8-15': '8-15 dias',
    '16-30': '16-30 dias',
    '31-60': '31-60 dias',
    '61+': '61+ dias',
  }

  return (
    <div className="space-y-4">
      {/* Date Range Selector */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Calendar className="w-4 h-4" />
          <span>Data de Vencimento</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={
              filters.dateFrom === today &&
              filters.dateTo === getDateRange('week', today)[1]
                ? 'default'
                : 'outline'
            }
            size="sm"
            onClick={() => handleDatePreset('week')}
          >
            Próxima Semana
          </Button>
          <Button
            variant={
              filters.dateFrom === today &&
              filters.dateTo === getDateRange('month', today)[1]
                ? 'default'
                : 'outline'
            }
            size="sm"
            onClick={() => handleDatePreset('month')}
          >
            Próximo Mês
          </Button>
          <Button
            variant={
              filters.dateFrom === today &&
              filters.dateTo === getDateRange('sixty', today)[1]
                ? 'default'
                : 'outline'
            }
            size="sm"
            onClick={() => handleDatePreset('sixty')}
          >
            Próximos 60 dias ⭐
          </Button>
          <Button
            variant={
              filters.dateFrom === today &&
              filters.dateTo === getDateRange('ninety', today)[1]
                ? 'default'
                : 'outline'
            }
            size="sm"
            onClick={() => handleDatePreset('ninety')}
          >
            Próximos 90 dias
          </Button>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">De</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
              className="w-full px-2 py-2 border rounded text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Até</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
              className="w-full px-2 py-2 border rounded text-sm"
            />
          </div>
        </div>
      </div>

      {/* Status Filter */}
      <div className="space-y-2">
        <div className="text-sm font-semibold">Status de Recebimento</div>
        <div className="flex gap-2 flex-wrap">
          {(Object.entries(statusLabels) as [ReceivableStatus, string][]).map(([status, label]) => (
            <Button
              key={status}
              variant={filters.status === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilters((prev) => ({ ...prev, status }))}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Client Filter */}
      {clients.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold">Cliente</div>
          <select
            value={filters.client}
            onChange={(e) => setFilters((prev) => ({ ...prev, client: e.target.value }))}
            className="w-full px-3 py-2 border rounded text-sm"
          >
            <option value="">Todos os clientes</option>
            {clients.map((client) => (
              <option key={client} value={client}>
                {client}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Value Filter */}
      <div className="space-y-2">
        <div className="text-sm font-semibold">Valor</div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Mínimo</label>
            <input
              type="number"
              placeholder="0"
              value={filters.minValue ?? ''}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  minValue: e.target.value ? parseFloat(e.target.value) : null,
                }))
              }
              className="w-full px-2 py-2 border rounded text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Máximo</label>
            <input
              type="number"
              placeholder="∞"
              value={filters.maxValue ?? ''}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  maxValue: e.target.value ? parseFloat(e.target.value) : null,
                }))
              }
              className="w-full px-2 py-2 border rounded text-sm"
            />
          </div>
        </div>
      </div>

      {/* Summary & Reset */}
      <div className="flex items-center justify-between pt-4 border-t">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            {filteredRows.length} de {rows.length} registros
          </Badge>
          <span className="text-xs text-muted-foreground">
            Total: {formatBRL(filteredRows.reduce((sum, row) => sum + (row.valor ?? 0), 0))}
          </span>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleReset} className="gap-2">
            <X className="w-4 h-4" />
            Limpar Filtros
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="pt-4 border-t">
        <AccountsReceivableTable rows={filteredRows} today={today} />
      </div>
    </div>
  )
}
