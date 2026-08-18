'use client'

import { useRouter } from 'next/navigation'
import type { ForecastVersion, ForecastScenario } from '@/lib/forecast/engine'

export function ReportControls({
  versions,
  scenarios,
  selectedVersionId,
  selectedScenarioId,
}: {
  versions: ForecastVersion[]
  scenarios: Array<{ scenario: ForecastScenario }>
  selectedVersionId: string
  selectedScenarioId?: string
}) {
  const router = useRouter()

  function handleVersionChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams()
    params.set('versionId', e.target.value)
    if (selectedScenarioId) {
      params.set('scenarioId', selectedScenarioId)
    }
    router.push(`/planejamento/forecast-vs-realizado?${params.toString()}`)
  }

  function handleScenarioChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams()
    params.set('versionId', selectedVersionId)
    if (e.target.value) {
      params.set('scenarioId', e.target.value)
    }
    router.push(`/planejamento/forecast-vs-realizado?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap gap-4">
      <div>
        <label htmlFor="version" className="block text-sm font-medium text-neutral-700">
          Versão
        </label>
        <select
          id="version"
          value={selectedVersionId}
          onChange={handleVersionChange}
          className="mt-1 rounded border border-neutral-300 px-3 py-2 text-sm"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} {v.id === versions[0].id ? '(atual)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="scenario" className="block text-sm font-medium text-neutral-700">
          Cenário
        </label>
        <select
          id="scenario"
          value={selectedScenarioId ?? ''}
          onChange={handleScenarioChange}
          className="mt-1 rounded border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="">100% (Base)</option>
          {scenarios.map((s) => (
            <option key={s.scenario.id} value={s.scenario.id}>
              {s.scenario.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
