'use client'

import { useState, useEffect } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { PlannedPayment, PaymentScenario } from '@/lib/payments/engine'

export default function PlanejarpagamentosPage() {
  const [payments, setPayments] = useState<PlannedPayment[]>([])
  const [scenarios, setScenarios] = useState<Array<{ scenario: PaymentScenario; adjustments: any[] }>>([])
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [paymentsRes, scenariosRes] = await Promise.all([
        fetch('/api/payments/planned'),
        fetch('/api/payments/scenarios'),
      ])
      setPayments((await paymentsRes.json()).payments || [])
      setScenarios((await scenariosRes.json()).scenarios || [])
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Carregando...</p>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Planejar Pagamentos</h1>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-medium">Pagamentos Planejados</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum pagamento planejado ainda.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.apId} className="flex items-center justify-between rounded border p-2 text-sm">
                <span className="font-mono">{p.apId.slice(0, 8)}</span>
                <span className="text-neutral-600">{formatDateOnlyBR(p.plannedDate)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-6">
        <h2 className="mb-4 text-lg font-medium">Cenários de Pagamento</h2>
        {scenarios.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum cenário criado ainda.</p>
        ) : (
          <div className="space-y-2">
            {scenarios.map((s) => (
              <button
                key={s.scenario.id}
                onClick={() => setSelectedScenario(s.scenario.id)}
                className={`w-full rounded border p-3 text-left transition ${
                  selectedScenario === s.scenario.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                <div className="font-medium">{s.scenario.name}</div>
                <div className="text-xs text-neutral-600">{s.adjustments.length} ajustes</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-blue-50 p-6">
        <h3 className="font-medium">What-if Impact</h3>
        <p className="mt-2 text-sm text-neutral-600">Selecione um cenário para ver o impacto no fluxo de caixa.</p>
      </div>
    </div>
  )
}
