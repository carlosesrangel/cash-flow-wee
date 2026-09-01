'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { PayableCandidate, PaymentScenario, PlannedPayment } from '@/lib/payments/engine'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

type Impact = { contasSelecionadas: number; totalSelecionado: number; saldoAntes: number; pagamentos: number; saldoDepois: number }
type ScenarioImpact = { saldoMinimoAntes: number; saldoMinimoDepois: number; dataSaldoMinimo: string; diasNegativosAntes: number; diasNegativosDepois: number; melhoria: boolean }
const DOTS = { gray: 'bg-neutral-400', red: 'bg-red-500', yellow: 'bg-amber-400', green: 'bg-emerald-500' } as const

export default function PlanejarpagamentosPage() {
  const [candidates, setCandidates] = useState<PayableCandidate[]>([])
  const [payments, setPayments] = useState<PlannedPayment[]>([])
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

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    const apIds = Array.from(selectedIds)
    void fetch('/api/payments/impact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apIds }) })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => setImpact(data?.impact ?? null))
      .catch(() => setImpact(null))
  }, [selectedIds])

  async function loadData() {
    setError(null)
    try {
      const [paymentsResponse, scenariosResponse] = await Promise.all([fetch('/api/payments/planned'), fetch('/api/payments/scenarios')])
      if (!paymentsResponse.ok || !scenariosResponse.ok) throw new Error('Não foi possível carregar o planejamento.')
      const paymentsData = await paymentsResponse.json()
      const scenariosData = await scenariosResponse.json()
      const nextCandidates = (paymentsData.candidates ?? []) as PayableCandidate[]
      setCandidates(nextCandidates)
      setPayments(paymentsData.payments ?? [])
      setScenarios(scenariosData.scenarios ?? [])
      setPlannedDates(Object.fromEntries(nextCandidates.map((candidate) => [candidate.apId, candidate.plannedDate ?? ''])))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o planejamento.')
    } finally {
      setLoading(false)
    }
  }

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
    const response = await fetch(`/api/payments/scenarios/${id}/impact`)
    if (response.ok) setScenarioImpact((await response.json()).impact)
  }

  if (loading) return <div className="space-y-6"><PageHeader title="Planejar Pagamentos" /><Card><CardContent className="pt-6"><Skeleton className="h-96" /></CardContent></Card></div>

  return (
    <div className="space-y-6">
      <PageHeader title="Planejar Pagamentos" description="Escolha as obrigações e simule o efeito dos pagamentos no caixa." />
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
              {candidates.map((candidate) => (
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

      <div className="grid gap-4 md:grid-cols-5">
        <Metric label="Contas selecionadas" value={String(selectedCandidates.length)} />
        <Metric label="Total selecionado" value={formatBRL(totalSelected)} />
        <Metric label="Saldo antes" value={impact ? formatBRL(impact.saldoAntes) : '—'} />
        <Metric label="Pagamentos" value={impact ? formatBRL(impact.pagamentos) : formatBRL(totalSelected)} />
        <Metric label="Saldo depois" value={impact ? formatBRL(impact.saldoDepois) : '—'} tone={impact && impact.saldoDepois < 0 ? 'red' : 'green'} />
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
