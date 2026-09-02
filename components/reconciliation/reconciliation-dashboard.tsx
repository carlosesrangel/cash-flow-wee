'use client'

import { useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { Badge } from '@/components/ui/badge'
import { ReconciliationTable, type MatchRow } from './reconciliation-table'
import type { ComparableSumupRow, ComparableUniverseReport } from '@/lib/reconciliation/comparable-universe'
import { isVerifiedReconciliation } from '@/lib/reconciliation/verification'

export function ReconciliationDashboard({ matches, canManage, universe, sumupRows = [] }: { matches: MatchRow[]; canManage: boolean; universe?: ComparableUniverseReport; sumupRows?: ComparableSumupRow[] }) {
  const matched = matches.filter((row) => isVerifiedReconciliation(row))
  const exceptions = matches.filter((row) => !isVerifiedReconciliation(row))
  const reconciledValue = matched.reduce((sum, row) => sum + Number(row.olist_accounts_receivable?.valor ?? 0), 0)
  const tinyComparableCount = universe?.TINY_COMPARABLE_COUNT ?? matches.length
  const tinyComparableValue = universe?.TINY_COMPARABLE_VALUE ?? matches.reduce((sum, row) => sum + Number(row.olist_accounts_receivable?.valor ?? 0), 0)
  const sumupComparableCount = universe?.SUMUP_COMPARABLE_COUNT ?? sumupRows.length
  const sumupComparableValue = universe?.SUMUP_COMPARABLE_VALUE ?? 0
  const variance = Math.round((tinyComparableValue - sumupComparableValue) * 100) / 100
  const matchedSumupIds = new Set(matched.map((row) => row.sumup_transaction_id).filter(Boolean))
  const unmatchedSumup = sumupRows.filter((row) => !matchedSumupIds.has(row.id) && ['pos', 'ecom'].includes(String(row.paymentType ?? '').toLowerCase()) && Boolean(!universe?.COMPARABLE_START_DATE || !row.date || (row.date >= universe.COMPARABLE_START_DATE && row.date <= (universe.COMPARABLE_END_DATE ?? row.date))))
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [minValue, setMinValue] = useState('')
  const [maxValue, setMaxValue] = useState('')
  const filteredMatches = matches.filter((row) => {
    const value = Number(row.olist_accounts_receivable?.valor ?? 0)
    if (statusFilter !== 'all' && row.status !== statusFilter) return false
    if (sourceFilter === 'sumup') return false
    if (minValue && value < Number(minValue)) return false
    if (maxValue && value > Number(maxValue)) return false
    return true
  }).sort((a, b) => Number(b.olist_accounts_receivable?.valor ?? 0) - Number(a.olist_accounts_receivable?.valor ?? 0))
  const comparableMatchRate = tinyComparableCount > 0 ? matched.length / tinyComparableCount : 0
  const unmatchedTinyCount = Math.max(tinyComparableCount - matched.length, 0)
  const unmatchedTinyValue = Math.max(Math.round((tinyComparableValue - reconciledValue) * 100) / 100, 0)
  const ambiguousCount = matches.filter((row) => row.match_reason?.v2_classification === 'AMBIGUOUS' || row.status === 'conflito').length
  return <div className="space-y-6">
    <section aria-labelledby="reconciliation-kpis"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 id="reconciliation-kpis" className="text-lg font-semibold">Resumo da reconciliação</h2><p className="text-sm text-muted-foreground">Universo comparável: {universe?.COMPARABLE_START_DATE ?? '—'} a {universe?.COMPARABLE_END_DATE ?? '—'} · sem fuzzy match.</p></div><div className="flex flex-wrap gap-2" aria-label="Fontes de reconciliação"><Badge variant="outline">Tiny · {universe?.TINY_COMPARABLE_COUNT ?? matches.length} comparáveis</Badge><Badge variant="outline">SumUp · {universe?.SUMUP_COMPARABLE_COUNT ?? unmatchedSumup.length} comparáveis</Badge><Badge variant="secondary">PIX e dinheiro · fora do SumUp</Badge></div></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"><Metric label="Match %" value={`${(comparableMatchRate * 100).toFixed(1)}%`} /><Metric label="Valor conciliado" value={formatBRL(reconciledValue)} /><Metric label="Matched" value={`${matched.length} · ${formatBRL(reconciledValue)}`} /><Metric label="Unmatched Tiny" value={`${unmatchedTinyCount} · ${formatBRL(unmatchedTinyValue)}`} tone="warning" /><Metric label="Unmatched SumUp" value={`${unmatchedSumup.length} · ${formatBRL(unmatchedSumup.reduce((s, r) => s + r.value, 0))}`} tone="warning" /><Metric label="Ambiguous" value={String(ambiguousCount)} tone="warning" /><Metric label="Value variance" value={formatBRL(variance)} tone={Math.abs(variance) > 0.01 ? 'warning' : 'default'} /></div>
    </section>
    <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-lg border bg-card p-4"><h2 className="font-semibold">Tiny x SumUp comparável</h2><div className="mt-4 space-y-3"><Bar label="Tiny" value={tinyComparableValue} max={Math.max(tinyComparableValue, sumupComparableValue)} /><Bar label="SumUp" value={sumupComparableValue} max={Math.max(tinyComparableValue, sumupComparableValue)} /></div><p className="mt-3 text-xs text-muted-foreground">Tiny {tinyComparableCount} vendas · SumUp {sumupComparableCount} transações · período e granularidade normalizados; nenhum fuzzy match.</p></div><div className="rounded-lg border bg-card p-4"><h2 className="font-semibold">Itens que exigem ação</h2><p className="mt-1 text-sm text-muted-foreground">Ordenados por impacto financeiro, com conflito separado de ausência de correspondência.</p><div className="mt-3 flex flex-wrap gap-2"><Badge variant="destructive">Conflitos · {ambiguousCount}</Badge><Badge variant="warning">Tiny sem par · {unmatchedTinyCount}</Badge><Badge variant="warning">SumUp sem par · {unmatchedSumup.length}</Badge></div></div></section>
    <section aria-label="Filtros de exceções" className="rounded-lg border bg-muted/20 p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-medium">Status<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"><option value="all">Todos</option><option value="nao_reconciliado">Não reconciliado</option><option value="conflito">Conflito</option><option value="reconciliado_automaticamente">Reconciliado</option></select></label><label className="text-sm font-medium">Fonte<select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"><option value="all">Todas</option><option value="tiny">Tiny</option><option value="sumup">SumUp</option></select></label><label className="text-sm font-medium">Valor mínimo<input type="number" min="0" step="0.01" value={minValue} onChange={(e) => setMinValue(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" /></label><label className="text-sm font-medium">Valor máximo<input type="number" min="0" step="0.01" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" /></label></div></section>
    {exceptions.length > 0 && <section className="rounded-lg border border-amber-300/70 bg-amber-50/50 p-4 dark:bg-amber-950/20"><h2 className="font-semibold">Exceções que exigem decisão</h2><p className="mt-1 text-sm text-muted-foreground">Links legados sem prova determinística, conflitos e parcelas não reconciliadas permanecem visíveis; nenhuma diferença é incorporada ao caixa silenciosamente.</p><div className="mt-3 space-y-2">{filteredMatches.filter((row) => !isVerifiedReconciliation(row)).slice(0, 8).map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm"><span>{row.olist_accounts_receivable?.numero_documento ?? row.olist_accounts_receivable?.historico ?? 'Parcela sem identificação'}</span><span className="text-muted-foreground">{row.match_reason?.v2_classification === 'LEGACY_UNVERIFIED' ? 'Legado sem prova' : row.match_reason?.v2_classification === 'AMBIGUOUS' || row.status === 'conflito' ? 'Conflito: escolha o candidato correto' : 'Sem correspondência confirmada'}</span><span className="font-mono">{formatBRL(Number(row.olist_accounts_receivable?.valor ?? 0))}</span></div>)}</div></section>}
    <ReconciliationTable matches={filteredMatches} canManage={canManage} />
  </div>
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' }) { return <div className="rounded-lg border bg-card p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-2 font-mono text-xl font-semibold ${tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : ''}`}>{value}</p></div> }
function Bar({ label, value, max }: { label: string; value: number; max: number }) { const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2; return <div><div className="flex justify-between text-sm"><span>{label}</span><span className="font-mono">{formatBRL(value)}</span></div><div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${width}%` }} /></div></div> }
