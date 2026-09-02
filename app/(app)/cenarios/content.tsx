'use client'

import { useMemo, useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { applyScenarioToPlan, type MonthlyPlan, type ScenarioConfig } from '@/lib/planning/canonical'
import { calculateProjectedCmv } from '@/lib/planning/canonical'
import { calculateEffectiveSimplesTaxRate } from '@/lib/tax/simples-nacional'
import { Badge } from '@/components/ui/badge'

export function CenariosContent({ plans, config, canEdit, now }: { plans: MonthlyPlan[]; config: ScenarioConfig; canEdit: boolean; now: string }) {
  const [selected, setSelected] = useState<'base' | 'conservative' | 'optimistic'>('base')
  const [conservative, setConservative] = useState(config.conservativePercent)
  const [optimistic, setOptimistic] = useState(config.optimisticPercent)
  const [message, setMessage] = useState<string | null>(null)
  const projected = useMemo(() => applyScenarioToPlan(plans, selected, { conservativePercent: conservative, optimisticPercent: optimistic }, new Date(now)), [plans, selected, conservative, optimistic, now])
  const summary = useMemo(() => {
    const future = projected.filter((plan) => plan.competenceMonth.slice(0, 7) > now.slice(0, 7))
    const revenue = future.reduce((sum, plan) => sum + plan.amount, 0)
    const cmv = future.reduce((sum, plan) => sum + calculateProjectedCmv(plan.amount, plan.competenceMonth).total, 0)
    const tax = future.reduce((sum, plan) => {
      const rbt12 = plans.filter((candidate) => candidate.competenceMonth < plan.competenceMonth).slice(-12).reduce((total, candidate) => total + candidate.amount, 0)
      return sum + plan.amount * calculateEffectiveSimplesTaxRate(rbt12, Number(plan.competenceMonth.slice(0, 4))).aliquota_efetiva
    }, 0)
    return { revenue, cmv, tax, net: revenue - cmv - tax }
  }, [plans, projected, now])

  async function save() {
    const response = await fetch('/api/planning/scenarios', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conservativePercent: conservative, optimisticPercent: optimistic }) })
    const body = await response.json().catch(() => ({}))
    setMessage(response.ok ? 'Parâmetros salvos.' : body.error ?? 'Não foi possível salvar.')
  }

  return <div className="space-y-6"><section className="rounded-lg border bg-card p-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="font-semibold">Simulação virtual</h2><p className="text-sm text-muted-foreground">O plano base não é alterado. Apenas meses futuros recebem o multiplicador selecionado.</p></div><div className="flex flex-wrap gap-2" role="group" aria-label="Cenário">{(['base', 'conservative', 'optimistic'] as const).map((scenario) => <button key={scenario} type="button" onClick={() => setSelected(scenario)} className={`rounded-md border px-3 py-2 text-sm ${selected === scenario ? 'border-primary bg-primary/10 font-medium' : 'bg-background'}`}>{scenario === 'base' ? 'Base 0%' : scenario === 'conservative' ? `Conservador -${conservative}%` : `Otimista +${optimistic}%`}</button>)}</div></div>{canEdit && <div className="mt-5 flex flex-wrap items-end gap-3 border-t pt-4"><label className="text-sm">Conservador (%)<input type="number" min="0" max="100" step="0.01" value={conservative} onChange={(e) => setConservative(Number(e.target.value))} className="mt-1 block h-9 w-28 rounded-md border px-2" /></label><label className="text-sm">Otimista (%)<input type="number" min="0" max="500" step="0.01" value={optimistic} onChange={(e) => setOptimistic(Number(e.target.value))} className="mt-1 block h-9 w-28 rounded-md border px-2" /></label><button type="button" onClick={save} className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Salvar parâmetros</button>{message && <span role="status" className="text-sm text-muted-foreground">{message}</span>}</div>}</section><section aria-label="Resumo do cenário selecionado" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Summary label="Receita projetada" value={summary.revenue} /><Summary label="Entradas projetadas" value={summary.revenue} /><Summary label="CMV projetado" value={summary.cmv} /><Summary label="Impostos projetados" value={summary.tax} /><Summary label="Fluxo líquido projetado" value={summary.net} /></section><section className="overflow-x-auto rounded-lg border bg-card"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b bg-muted/50 text-muted-foreground"><tr><th className="px-4 py-3">Competência</th><th className="px-4 py-3 text-right">Base</th><th className="px-4 py-3 text-right">Simulado</th><th className="px-4 py-3 text-right">Variação</th><th className="px-4 py-3 text-center">Regra</th></tr></thead><tbody>{projected.map((plan, index) => { const base = plans[index]?.amount ?? 0; const future = plan.amount !== base; return <tr key={plan.competenceMonth} className="border-b last:border-0"><td className="px-4 py-3">{new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${plan.competenceMonth.slice(0, 7)}-01T00:00:00Z`))}</td><td className="px-4 py-3 text-right font-mono">{formatBRL(base)}</td><td className="px-4 py-3 text-right font-mono">{formatBRL(plan.amount)}</td><td className="px-4 py-3 text-right font-mono">{formatBRL(plan.amount - base)}</td><td className="px-4 py-3 text-center"><Badge variant={future ? 'success' : 'secondary'}>{future ? 'Virtual' : 'Protegido'}</Badge></td></tr> })}</tbody></table></section></div>
}

function Summary({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border bg-card p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-mono text-xl font-semibold">{formatBRL(value)}</p></div> }
