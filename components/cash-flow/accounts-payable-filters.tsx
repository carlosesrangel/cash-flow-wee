'use client'

import { useMemo, useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { AccountsPayableTable, type AccountsPayableRow } from '@/components/cash-flow/accounts-payable-table'
import {
  calculatePayableTotals,
  getPayableStatusCounts,
  matchesPayableFilter,
  UNCATEGORIZED_FILTER,
  type PayableFilterState,
} from '@/lib/payables/filters'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import { getCashFlowDateRange, type CashFlowDatePreset } from '@/lib/cash-flow/date-presets'

const STATUS_FILTERS: Array<{ value: PayableFilterState['status']; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Em aberto' },
  { value: 'due_soon', label: 'Vencendo em 7 dias' },
  { value: 'paid', label: 'Pagas' },
  { value: 'overdue', label: 'Atrasadas' },
  { value: 'cancelled', label: 'Canceladas' },
]

export function AccountsPayableFilters({
  rows,
  suppliers,
  today,
}: {
  rows: AccountsPayableRow[]
  suppliers: string[]
  today: string
}) {
  const [filters, setFilters] = useState<PayableFilterState>({
    status: 'all',
    categoria: 'all',
    fornecedor: '',
    minValue: null,
    maxValue: null,
    dateFrom: getCashFlowDateRange('proximos-30', today)[0],
    dateTo: getCashFlowDateRange('proximos-30', today)[1],
  })
  const categories = useMemo(
    () => Array.from(new Set(rows.map((row) => row.categoria?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [rows]
  )
  const counts = useMemo(() => getPayableStatusCounts(rows), [rows])
  const filteredRows = useMemo(() => rows.filter((row) => matchesPayableFilter(row, filters)), [rows, filters])
  const totals = useMemo(() => calculatePayableTotals(filteredRows), [filteredRows])
  const hasUncategorized = rows.some((row) => !row.categoria?.trim())
  const defaultFrom = getCashFlowDateRange('proximos-30', today)[0]
  const defaultTo = getCashFlowDateRange('proximos-30', today)[1]
  const hasActiveFilters = filters.status !== 'all' || filters.categoria !== 'all' || Boolean(filters.fornecedor) || filters.minValue !== null || filters.maxValue !== null || filters.dateFrom !== defaultFrom || filters.dateTo !== defaultTo
  const reset = () => setFilters({ status: 'all', categoria: 'all', fornecedor: '', minValue: null, maxValue: null, dateFrom: getCashFlowDateRange('proximos-30', today)[0], dateTo: getCashFlowDateRange('proximos-30', today)[1] })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" aria-label="Filtros de status">
        {STATUS_FILTERS.map((option) => (
          <Button key={option.value} type="button" size="sm" variant={filters.status === option.value ? 'default' : 'outline'} onClick={() => setFilters((previous) => ({ ...previous, status: option.value }))}>
            {option.label} <span className="ml-1 opacity-75">{counts[option.value]}</span>
          </Button>
        ))}
      </div>

      <div className="space-y-2"><p className="text-sm font-semibold">Data de vencimento</p><div className="flex flex-wrap gap-2">{(['ontem', 'hoje', 'este-mes', 'mes-anterior', 'este-ano', 'ano-anterior', 'proximo-mes', 'proximos-30', 'ultimos-30'] as CashFlowDatePreset[]).map((preset) => { const range = getCashFlowDateRange(preset, today); const labels: Record<CashFlowDatePreset, string> = { ontem: 'Ontem', hoje: 'Hoje', 'este-mes': 'Este mês', 'mes-anterior': 'Mês anterior', 'este-ano': 'Este ano', 'ano-anterior': 'Ano anterior', 'proximo-mes': 'Próximo mês', 'proximos-30': 'Próximos 30 dias', 'ultimos-30': 'Últimos 30 dias' }; return <Button key={preset} type="button" size="sm" variant={filters.dateFrom === range[0] && filters.dateTo === range[1] ? 'default' : 'outline'} onClick={() => setFilters((previous) => ({ ...previous, dateFrom: range[0], dateTo: range[1] }))}>{labels[preset]}</Button> })}</div><div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted-foreground">De<input aria-label="Vencimento de" type="date" value={filters.dateFrom} onChange={(e) => setFilters((previous) => ({ ...previous, dateFrom: e.target.value }))} className="mt-1 w-full rounded-md border px-2 py-2 text-sm" /></label><label className="text-xs text-muted-foreground">Até<input aria-label="Vencimento até" type="date" value={filters.dateTo} onChange={(e) => setFilters((previous) => ({ ...previous, dateTo: e.target.value }))} className="mt-1 w-full rounded-md border px-2 py-2 text-sm" /></label></div></div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm font-medium">
          <span>Categoria</span>
          <select aria-label="Categoria" value={filters.categoria} onChange={(event) => setFilters((previous) => ({ ...previous, categoria: event.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal">
            <option value="all">Todas as categorias</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            {hasUncategorized && <option value={UNCATEGORIZED_FILTER}>Sem categoria</option>}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Fornecedor</span>
          <select aria-label="Fornecedor" value={filters.fornecedor} onChange={(event) => setFilters((previous) => ({ ...previous, fornecedor: event.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal">
            <option value="">Todos os fornecedores</option>
            {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-sm font-medium"><span>Mínimo</span><input aria-label="Valor mínimo" type="number" min="0" step="0.01" value={filters.minValue ?? ''} onChange={(event) => setFilters((previous) => ({ ...previous, minValue: event.target.value ? Number(event.target.value) : null }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal" /></label>
          <label className="space-y-1 text-sm font-medium"><span>Máximo</span><input aria-label="Valor máximo" type="number" min="0" step="0.01" value={filters.maxValue ?? ''} onChange={(event) => setFilters((previous) => ({ ...previous, maxValue: event.target.value ? Number(event.target.value) : null }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal" /></label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Saldo total em aberto" value={totals.openBalance} />
        <Summary label="Saldo atrasado" value={totals.overdueBalance} tone="red" />
        <Summary label="Saldo vencendo em até 7 dias" value={totals.dueSoonBalance} tone="amber" />
        <Summary label="Saldo aberto >7 dias" value={totals.openOver7Balance} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <div className="flex items-center gap-2"><Badge variant="secondary">{filteredRows.length} de {rows.length} contas</Badge><span className="text-sm text-muted-foreground">Totais com saldo conhecido.</span></div>
        {hasActiveFilters && <Button type="button" variant="ghost" size="sm" onClick={reset} className="gap-2"><X className="h-4 w-4" />Limpar filtros</Button>}
      </div>
      <AccountsPayableTable rows={filteredRows} today={today} />
    </div>
  )
}

function Summary({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'red' | 'amber' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-foreground'
  return <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 font-mono text-lg font-semibold ${toneClass}`}>{formatBRL(value)}</p></div>
}
