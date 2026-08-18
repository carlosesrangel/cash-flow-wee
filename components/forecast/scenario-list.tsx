'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ForecastScenario } from '@/lib/forecast/engine'

export function ScenarioList({
  scenarios,
  canCreate,
  onSelect,
}: {
  scenarios: ForecastScenario[]
  canCreate: boolean
  onSelect: (scenarioId: string) => void
}) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleCreateScenario() {
    if (!name.trim()) {
      setError('Nome do cenário é obrigatório')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/forecast/cenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao criar cenário')
      } else {
        setName('')
        setShowForm(false)
        router.refresh()
        onSelect(data.id)
      }
    } catch {
      setError('Falha ao criar cenário')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cenários</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
            Novo Cenário
          </button>
        )}
      </div>

      {showForm && (
        <div className="rounded-lg border bg-neutral-50 p-4">
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Nome do cenário"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded border px-3 py-2 text-sm disabled:bg-neutral-100"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleCreateScenario}
                disabled={isSubmitting}
                className="rounded bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:bg-neutral-300"
              >
                {isSubmitting ? 'Salvando...' : 'Criar'}
              </button>
              <button
                onClick={() => {
                  setShowForm(false)
                  setName('')
                  setError(null)
                }}
                disabled={isSubmitting}
                className="rounded border px-3 py-1 text-sm font-medium hover:bg-neutral-100 disabled:bg-neutral-100"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {scenarios.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum cenário criado ainda.</p>
        ) : (
          scenarios.map((scenario) => (
            <button
              key={scenario.id}
              onClick={() => onSelect(scenario.id)}
              className="w-full rounded-lg border p-3 text-left transition hover:bg-blue-50 hover:border-blue-300"
            >
              <div className="font-medium text-neutral-900">{scenario.name}</div>
              <div className="text-xs text-neutral-500">Criado em {new Date(scenario.createdAt).toLocaleDateString('pt-BR')}</div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
