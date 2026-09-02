'use client'

import { useMemo, useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { isPlanEditable, monthKey, type MonthlyPlan } from '@/lib/planning/canonical'
import { Badge } from '@/components/ui/badge'

function monthLabel(key: string) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${key}-01T00:00:00Z`))
}

export function CanonicalPlanGrid({ plans, canEdit, now }: { plans: MonthlyPlan[]; canEdit: boolean; now: string }) {
  const [values, setValues] = useState(() => new Map(plans.map((plan) => [plan.competenceMonth.slice(0, 7), plan.amount])))
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const current = new Date(now)
  const months = useMemo(() => Array.from({ length: 84 }, (_, index) => {
    const date = new Date(Date.UTC(2024, index, 1))
    return monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1)
  }), [])
  const existingCount = plans.length

  async function save(key: string) {
    const amount = Number(values.get(key))
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage('Informe um valor maior ou igual a zero.')
      return
    }
    setSaving(key)
    setMessage(null)
    const response = await fetch('/api/planning', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ competenceMonth: `${key}-01`, amount }),
    })
    const body = await response.json().catch(() => ({}))
    setSaving(null)
    if (!response.ok) setMessage(body.error ?? 'Não foi possível salvar o plano.')
    else setMessage(`Plano de ${monthLabel(key)} atualizado.`)
  }

  return (
    <section className="space-y-4" aria-labelledby="canonical-plan-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="canonical-plan-title" className="text-lg font-semibold">Plano mensal canônico</h2>
          <p className="text-sm text-muted-foreground">Uma única fonte de verdade. Competência corrente e passada ficam protegidas.</p>
        </div>
        <Badge variant="outline">{existingCount} competências carregadas</Badge>
      </div>
      {message && <p role="status" className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{message}</p>}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b bg-muted/50 text-muted-foreground"><tr><th className="px-4 py-3">Competência</th><th className="px-4 py-3 text-right">Planejado</th><th className="px-4 py-3 text-center">Regra</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
          <tbody>
            {months.map((key) => {
              const editable = canEdit && isPlanEditable(`${key}-01`, current)
              const value = values.get(key)
              return <tr key={key} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium capitalize">{monthLabel(key)}</td>
                <td className="px-4 py-2 text-right">
                  {editable ? <input aria-label={`Planejado ${key}`} type="number" min="0" step="0.01" value={value ?? ''} onChange={(event) => setValues((previous) => new Map(previous).set(key, event.target.value === '' ? NaN : Number(event.target.value)))} className="h-9 w-40 rounded-md border bg-background px-3 text-right font-mono" placeholder="—" /> : <span className="font-mono">{value == null || Number.isNaN(value) ? '—' : formatBRL(value)}</span>}
                </td>
                <td className="px-4 py-3 text-center"><Badge variant={editable ? 'success' : 'secondary'}>{editable ? 'Editável' : 'Somente leitura'}</Badge></td>
                <td className="px-4 py-2 text-right">{editable && <button type="button" disabled={saving === key} onClick={() => save(key)} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{saving === key ? 'Salvando…' : 'Salvar'}</button>}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
