'use client'

import { useState, useEffect } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { PlannedPayment, PaymentScenario } from '@/lib/payments/engine'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricCard } from '@/components/ui/metric-card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ChevronDown } from 'lucide-react'

interface ScenarioImpact {
  saldoMinimoAntes: number
  saldoMinimoDepois: number
  dataSaldoMinimo: string
  diasNegativosAntes: number
  diasNegativosDepois: number
  melhoria: boolean
}

export default function PlanejarpagamentosPage() {
  const [payments, setPayments] = useState<PlannedPayment[]>([])
  const [scenarios, setScenarios] = useState<Array<{ scenario: PaymentScenario; adjustments: any[] }>>([])
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null)
  const [impact, setImpact] = useState<ScenarioImpact | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingImpact, setLoadingImpact] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [paymentsRes, scenariosRes] = await Promise.all([
        fetch('/api/payments/planned'),
        fetch('/api/payments/scenarios'),
      ])
      const paymentsData = (await paymentsRes.json()).payments || []
      const scenariosData = (await scenariosRes.json()).scenarios || []
      setPayments(paymentsData)
      setScenarios(scenariosData)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadScenarioImpact(scenarioId: string) {
    setLoadingImpact(true)
    try {
      const res = await fetch(`/api/payments/scenarios/${scenarioId}/impact`)
      if (res.ok) {
        const data = await res.json()
        setImpact(data.impact)
      }
    } catch (error) {
      console.error('Failed to load scenario impact:', error)
    } finally {
      setLoadingImpact(false)
    }
  }

  const handleScenarioSelect = (scenarioId: string) => {
    setSelectedScenario(scenarioId)
    loadScenarioImpact(scenarioId)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Planejar Pagamentos" />
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-64" />
          </CardContent>
        </Card>
      </div>
    )
  }

  const totalPayments = payments.reduce((sum, p) => sum + p.valor, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planejar Pagamentos"
        description="Simule ajustes nas datas de vencimento e veja o impacto no fluxo de caixa"
      />

      {/* Summary Cards */}
      {payments.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Pagamentos Pendentes"
            value={payments.length.toString()}
            accentColor="#082d74"
          />
          <MetricCard
            label="Valor Total"
            value={formatBRL(totalPayments)}
            accentColor="#082d74"
          />
          <MetricCard
            label="Cenários Disponíveis"
            value={scenarios.length.toString()}
            accentColor="#082d74"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pagamentos Planejados */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contas a Pagar</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <EmptyState
                title="Nenhum pagamento"
                description="Você não tem contas a pagar no próximo período"
              />
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {payments.map((p) => (
                  <div key={p.apId} className="rounded-lg border border-border bg-muted/30 p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">
                          {p.fornecedor || p.numeroDocumento || 'Sem dados'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {p.descricao || p.historico || p.apId.slice(0, 8)}
                        </p>
                      </div>
                      <p className="font-mono font-semibold text-foreground whitespace-nowrap">
                        {formatBRL(p.valor)}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      Vencimento: {formatDateOnlyBR(p.plannedDate)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cenários */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cenários de Simulação</CardTitle>
          </CardHeader>
          <CardContent>
            {scenarios.length === 0 ? (
              <EmptyState
                title="Nenhum cenário"
                description="Crie um cenário para começar a simular"
              />
            ) : (
              <div className="space-y-2">
                {scenarios.map((s) => (
                  <button
                    key={s.scenario.id}
                    onClick={() => handleScenarioSelect(s.scenario.id)}
                    className={`w-full rounded-lg border p-4 text-left transition-all ${
                      selectedScenario === s.scenario.id
                        ? 'border-primary bg-primary/10 shadow-md'
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground">{s.scenario.name}</p>
                        <p className="text-sm text-muted-foreground mt-1">{s.adjustments.length} ajustes aplicados</p>
                      </div>
                      {selectedScenario === s.scenario.id && (
                        <div className="shrink-0">
                          <Badge className="bg-primary">Selecionado</Badge>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Impacto do Cenário */}
      {selectedScenario && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Análise de Impacto</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingImpact ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
              </div>
            ) : impact ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 mb-6">
                  <MetricCard
                    label="Saldo Mínimo Antes"
                    value={formatBRL(impact.saldoMinimoAntes)}
                    accentColor={impact.saldoMinimoAntes < 0 ? 'red' : 'navy'}
                    footnote={`em ${formatDateOnlyBR(impact.dataSaldoMinimo)}`}
                  />
                  <MetricCard
                    label="Saldo Mínimo Depois"
                    value={formatBRL(impact.saldoMinimoDepois)}
                    accentColor={impact.saldoMinimoDepois < 0 ? 'red' : 'green'}
                  />
                  <MetricCard
                    label="Dias Negativos Antes"
                    value={`${impact.diasNegativosAntes} dias`}
                    accentColor="red"
                  />
                  <MetricCard
                    label="Dias Negativos Depois"
                    value={`${impact.diasNegativosDepois} dias`}
                    accentColor={impact.diasNegativosDepois < impact.diasNegativosAntes ? 'green' : 'red'}
                  />
                </div>

                {impact.melhoria && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-200">
                      ✓ Esta simulação melhora o fluxo de caixa
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-300 mt-1">
                      Saldo mínimo: +{formatBRL(impact.saldoMinimoDepois - impact.saldoMinimoAntes)} |
                      Dias negativos: -{impact.diasNegativosAntes - impact.diasNegativosDepois}d
                    </p>
                  </div>
                )}

                {!impact.melhoria && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
                    <p className="text-sm font-semibold text-red-700 dark:text-red-200">
                      ⚠ Esta simulação piora o fluxo de caixa
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                      Considere ajustar as datas dos pagamentos
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
                <p className="text-sm text-muted-foreground">Selecione um cenário para ver o impacto</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
