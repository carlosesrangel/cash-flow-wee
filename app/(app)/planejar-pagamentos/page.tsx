'use client'

import { Suspense, useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { CashFlowPeriodFilter } from '@/components/filters/cash-flow-period-filter'
import { getCashFlowDateRange } from '@/lib/cash-flow/date-presets'
import { toLocalDateParam } from '@/lib/integrations/date'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { PayableCandidate, PaymentScenario } from '@/lib/payments/engine'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

type Impact = { contasSelecionadas: number; totalSelecionado: number; saldoAntes: number | null; pagamentos: number; saldoDepois: number | null }
type ScenarioImpact = { saldoMinimoAntes: number; saldoMinimoDepois: number; dataSaldoMinimo: string; diasNegativosAntes: number; diasNegativosDepois: number; melhoria: boolean }
const DOTS = { gray: 'bg-neutral-400', red: 'bg-red-500', yellow: 'bg-amber-400', green: 'bg-emerald-500' } as const

export default function PlanejarpagamentosPage() {
  return <Suspense fallback={<p>Carregando planejamento...</p>}><PaymentPlanning /></Suspense>
}
function PaymentPlanning() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const today = toLocalDateParam(new Date())
  const defaults = getCashFlowDateRange('proximos-30', today)
  const from = searchParams.get('from') ?? defaults[0]
  const to = searchParams.get('to') ?? defaults[1]
  const invalidPeriod = Boolean(from && to && from > to)
  const periodQuery = new URLSearchParams({ from, to }).toString()
  const requestId = useRef(0)
  const [page, setPage] = useState(1)
  function changePeriod(start: string, end: string) {
    const params = new URLSearchParams(searchParams)
    params.set('from', start); params.set('to', end)
    router.replace(`?${params.toString()}`, { scroll: false })
  }
  const [candidates, setCandidates] = useState<PayableCandidate[]>([])
  const [scenarios, setScenarios] = useState<Array<{ scenario: PaymentScenario; adjustments: any[] }>>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [plannedDates, setPlannedDates] = useState<Record<string, string>>({})
  const [impact, setImpact] = useState<Impact | null>(null)
  const [scenarioImpact, setScenarioImpact] = useState<ScenarioImpact | null>(null)
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const id = ++requestId.current
    setError(null)
    setSelectedIds(new Set())
    setImpact(null)
    setScenarioImpact(null)
    setSelectedScenario(null)
    setCandidates([])
    setPage(1)
    if (invalidPeriod) { setLoading(false); return }
    setLoading(true)
    try {
      const [paymentsResponse, scenariosResponse] = await Promise.all([fetch(`/api/payments/planned?${periodQuery}`), fetch('/api/payments/scenarios')])
      if (!paymentsResponse.ok || !scenariosResponse.ok) throw new Error('N?o foi poss?vel carregar o planejamento.')
      const paymentsData = await paymentsResponse.json()
      const scenariosData = await scenariosResponse.json()
      if (id !== requestId.current) return
      const nextCandidates = (paymentsData.candidates ?? []) as PayableCandidate[]
      setCandidates(nextCandidates)
      setScenarios(scenariosData.scenarios ?? [])
      setPlannedDates(Object.fromEntries(nextCandidates.map(candidate => [candidate.apId, candidate.plannedDate ?? ''])))
    } catch (loadError) {
      if (id === requestId.current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar.')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [periodQuery, invalidPeriod])
  // The loader updates local state after the asynchronous request completes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadData(); return () => { requestId.current++ } }, [loadData])
  useEffect(() => {
    const controller = new AbortController()
    if (invalidPeriod) return
    void fetch('/api/payments/impact', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apIds: Array.from(selectedIds), from, to }) })
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (!controller.signal.aborted) setImpact(data?.impact ?? null) })
      .catch(() => { if (!controller.signal.aborted) setImpact(null) })
    return () => controller.abort()
  }, [selectedIds, from, to, invalidPeriod])

  const selectedCandidates = useMemo(() => candidates.filter((candidate) => selectedIds.has(candidate.apId)), [candidates, selectedIds])
  const totalSelected = useMemo(() => selectedCandidates.reduce((sum, candidate) => sum + candidate.saldo, 0), [selectedCandidates])
  const allSelected = candidates.length > 0 && selectedIds.size === candidates.length

  const toggle = (apId: string) => setSelectedIds((current) => {
    const next = new Set(current)
    if (next.has(apId)) next.delete(apId)
    else next.add(apId)
    return next
  })
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(candidates.map((candidate) => candidate.apId)))

  async function saveSelection() {
    if (selectedCandidates.length === 0) return
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/payments/planned', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payments: selectedCandidates.map((candidate) => ({ apId: candidate.apId, plannedDate: plannedDates[candidate.apId] || candidate.dataVencimento })) }),
      })
      if (!response.ok) throw new Error('Não foi possível salvar os pagamentos.')
      setMessage(`${selectedCandidates.length} pagamento(s) planejado(s).`)
      await loadData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar os pagamentos.')
    } finally {
      setSaving(false)
    }
  }

  async function selectScenario(id: string) {
    setSelectedScenario(id)
    setScenarioImpact(null)
    const response = await fetch(`/api/payments/scenarios/${id}/impact?${periodQuery}`)
    if (response.ok) setScenarioImpact((await response.json()).impact)
  }


  return (
    <div className="space-y-6">
      <PageHeader title="Planejar Pagamentos" description="Escolha as obrigações e simule o efeito dos pagamentos no caixa." />
      <CashFlowPeriodFilter from={from} to={to} today={today} onChange={changePeriod} />
      {loading && <p role="status">Atualizando pagamentos...</p>}
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">{message}</div>}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-lg">Contas candidatas</CardTitle><Badge variant="secondary">{candidates.length} em aberto</Badge></CardHeader>
        <CardContent>
          {candidates.length === 0 ? <EmptyState title="Nenhum pagamento pendente" description="Pagas e canceladas não entram no planejamento." /> : <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar todas as contas" />Selecionar todas</label>
              <Button type="button" size="sm" onClick={saveSelection} disabled={saving || selectedCandidates.length === 0}>{saving ? 'Salvando...' : 'Salvar planejamento'}</Button>
            </div>
            <div className="space-y-2">
              {candidates.slice((page - 1) * 50, page * 50).map((candidate) => (
                <div key={candidate.apId} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[auto_1fr_auto_auto_auto] md:items-center">
                  <input type="checkbox" checked={selectedIds.has(candidate.apId)} onChange={() => toggle(candidate.apId)} aria-label={`Selecionar ${candidate.fornecedorNome || candidate.apId}`} />
                  <div className="min-w-0"><p className="truncate font-medium">{candidate.fornecedorNome || 'Fornecedor não informado'}</p><p className="truncate text-xs text-muted-foreground">{candidate.categoria || 'Sem categoria'} · vencimento {candidate.dataVencimento ? formatDateOnlyBR(candidate.dataVencimento) : 'sem data'}</p></div>
                  <span className="inline-flex items-center gap-2 text-sm" title={candidate.payableStatus.label}><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${DOTS[candidate.payableStatus.color]}`} />{candidate.payableStatus.label}</span>
                  <span className="font-mono text-sm font-semibold">{formatBRL(candidate.saldo)}</span>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">Data planejada<input type="date" value={plannedDates[candidate.apId] ?? ''} onChange={(event) => setPlannedDates((current) => ({ ...current, [candidate.apId]: event.target.value }))} className="rounded border px-2 py-1 text-sm text-foreground" /></label>
                </div>
              ))}
            </div>
          </>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">Total em aberto no per?odo: {formatBRL(candidates.reduce((sum, c) => sum + c.saldo, 0))}</p>
        <div className="flex items-center gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button><span>P?gina {page} de {Math.max(1, Math.ceil(candidates.length / 50))}</span><Button variant="outline" disabled={page * 50 >= candidates.length} onClick={() => setPage(p => p + 1)}>Pr?xima</Button></div>
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <Metric label="Contas selecionadas" value={String(selectedCandidates.length)} />
        <Metric label="Total selecionado" value={formatBRL(totalSelected)} />
        <Metric label="Saldo antes" value={impact?.saldoAntes != null ? formatBRL(impact.saldoAntes) : '—'} />
        <Metric label="Pagamentos" value={impact ? formatBRL(impact.pagamentos) : formatBRL(totalSelected)} />
        <Metric label="Saldo depois" value={impact?.saldoDepois != null ? formatBRL(impact.saldoDepois) : '—'} tone={impact?.saldoDepois != null && impact.saldoDepois < 0 ? 'red' : 'green'} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Cenários de Simulação</CardTitle></CardHeader>
        <CardContent>{scenarios.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum cenário cadastrado.</p> : <div className="space-y-2">{scenarios.map(({ scenario, adjustments }) => <button key={scenario.id} type="button" onClick={() => void selectScenario(scenario.id)} className={`w-full rounded-lg border p-3 text-left ${selectedScenario === scenario.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}><span className="font-medium">{scenario.name}</span><span className="ml-2 text-sm text-muted-foreground">{adjustments.length} ajustes</span></button>)}</div>}</CardContent>
      </Card>
      {scenarioImpact && <Card><CardHeader><CardTitle className="text-lg">Impacto do cenário</CardTitle></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-4"><Metric label="Mínimo antes" value={formatBRL(scenarioImpact.saldoMinimoAntes)} /><Metric label="Mínimo depois" value={formatBRL(scenarioImpact.saldoMinimoDepois)} tone={scenarioImpact.saldoMinimoDepois < 0 ? 'red' : 'green'} /><Metric label="Dias negativos antes" value={`${scenarioImpact.diasNegativosAntes} dias`} tone="red" /><Metric label="Dias negativos depois" value={`${scenarioImpact.diasNegativosDepois} dias`} tone={scenarioImpact.diasNegativosDepois < scenarioImpact.diasNegativosAntes ? 'green' : 'red'} /></div><p className="mt-3 text-sm text-muted-foreground">Ponto mínimo em {formatDateOnlyBR(scenarioImpact.dataSaldoMinimo)}.</p></CardContent></Card>}
    </div>
  )
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'red' | 'green' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-600' : 'text-foreground'
  return <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 font-mono text-lg font-semibold ${toneClass}`}>{value}</p></div>
}
