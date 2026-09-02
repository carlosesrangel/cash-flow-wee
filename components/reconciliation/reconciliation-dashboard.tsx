'use client'

import { formatBRL } from '@/lib/format/currency'
import { Badge } from '@/components/ui/badge'
import { ReconciliationTable, type MatchRow } from './reconciliation-table'

const resolved = new Set(['reconciliado_automaticamente', 'reconciliado_manualmente'])

export function ReconciliationDashboard({ matches, canManage }: { matches: MatchRow[]; canManage: boolean }) {
  const matched = matches.filter((row) => resolved.has(row.status))
  const exceptions = matches.filter((row) => !resolved.has(row.status))
  const totalTiny = matches.reduce((sum, row) => sum + Number(row.olist_accounts_receivable?.valor ?? 0), 0)
  const reconciledValue = matched.reduce((sum, row) => sum + Number(row.olist_accounts_receivable?.valor ?? 0), 0)
  const candidateValue = matched.reduce((sum, row) => sum + Number(row.match_reason?.candidatos?.[0]?.valorBrutoSumupEstimado ?? 0), 0)
  const variance = Math.round((reconciledValue - candidateValue) * 100) / 100
  const matchRate = totalTiny > 0 ? reconciledValue / totalTiny : 0
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2" aria-label="Fontes de reconciliação"><Badge variant="outline">Tiny · {matches.length} parcelas</Badge><Badge variant="outline">SumUp · {matched.length} vinculadas</Badge><Badge variant="outline">Cartão · {matches.length} analisadas</Badge><Badge variant="secondary">PIX e dinheiro · fora da reconciliação SumUp</Badge></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Registros Tiny" value={String(matches.length)} /><Metric label="Reconciliados" value={String(matched.length)} /><Metric label="Exceções" value={String(exceptions.length)} tone={exceptions.length > 0 ? 'warning' : 'default'} /><Metric label="Taxa por valor" value={`${(matchRate * 100).toFixed(1)}%`} /><Metric label="Variância" value={formatBRL(variance)} tone={Math.abs(variance) > 0.01 ? 'warning' : 'default'} /></div>
    {exceptions.length > 0 && <section className="rounded-lg border border-amber-300/70 bg-amber-50/50 p-4 dark:bg-amber-950/20"><h2 className="font-semibold">Exceções que exigem decisão</h2><p className="mt-1 text-sm text-muted-foreground">Conflitos e parcelas não reconciliadas aparecem primeiro para evitar que uma diferença seja silenciosamente incorporada ao caixa.</p><div className="mt-3 space-y-2">{exceptions.slice(0, 8).map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm"><span>{row.olist_accounts_receivable?.numero_documento ?? row.olist_accounts_receivable?.historico ?? 'Parcela sem identificação'}</span><span className="text-muted-foreground">{row.status === 'conflito' ? 'Conflito: escolha o candidato correto' : 'Sem correspondência confirmada'}</span><span className="font-mono">{formatBRL(Number(row.olist_accounts_receivable?.valor ?? 0))}</span></div>)}</div></section>}
    <ReconciliationTable matches={matches} canManage={canManage} />
  </div>
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' }) { return <div className="rounded-lg border bg-card p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-2 font-mono text-xl font-semibold ${tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : ''}`}>{value}</p></div> }
