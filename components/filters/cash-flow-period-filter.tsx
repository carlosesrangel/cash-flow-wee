'use client'
import { getCashFlowDateRange, type CashFlowDatePreset } from '@/lib/cash-flow/date-presets'
import { Button } from '@/components/ui/button'

const presets: Array<[CashFlowDatePreset, string]> = [['hoje', 'Hoje'], ['esta-semana', 'Esta semana'], ['este-mes', 'Este mês'], ['mes-anterior', 'Mês anterior'], ['proximos-30', 'Próximos 30 dias'], ['este-ano', 'Este ano']]

export function CashFlowPeriodFilter({ from, to, today, onChange }: { from: string; to: string; today: string; onChange: (from: string, to: string) => void }) {
  const invalid = Boolean(from && to && from > to)
  return <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Período por vencimento">
    <p className="text-sm font-semibold">Data de vencimento</p>
    <div className="flex flex-wrap gap-2">{presets.map(([preset, label]) => {
      const range = getCashFlowDateRange(preset, today)
      return <Button key={preset} type="button" size="sm" variant={range[0] === from && range[1] === to ? 'default' : 'outline'} onClick={() => onChange(...range)}>{label}</Button>
    })}</div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Data inicial<input aria-label="Data inicial" type="date" value={from} onChange={e => onChange(e.target.value, to)} className="mt-1 block w-full rounded border bg-background p-2" /></label>
      <label className="text-sm">Data final<input aria-label="Data final" type="date" value={to} onChange={e => onChange(from, e.target.value)} className="mt-1 block w-full rounded border bg-background p-2" /></label>
    </div>
    {invalid && <p role="alert" className="text-sm text-destructive">A data inicial deve ser anterior ou igual à data final.</p>}
  </section>
}
