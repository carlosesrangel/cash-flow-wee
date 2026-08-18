'use client'

import { ScenarioList } from '@/components/forecast/scenario-list'
import { ScenarioMultipliersGrid } from '@/components/forecast/scenario-multipliers-grid'
import type { ForecastScenario } from '@/lib/forecast/engine'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

export function CenariosContent({
  scenarios,
  canCreate,
}: {
  scenarios: Array<{ scenario: ForecastScenario; multipliers: MonthlyValue[] }>
  canCreate: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <ScenarioList scenarios={scenarios.map((s) => s.scenario)} canCreate={canCreate} onSelect={() => {}} />
      </div>

      <div className="space-y-6 lg:col-span-2">
        {scenarios.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-neutral-50 p-6 text-center">
            <p className="text-sm text-neutral-600">Nenhum cenário de projeção criado ainda.</p>
            {canCreate && <p className="mt-2 text-xs text-neutral-500">Use o formulário ao lado para criar o primeiro.</p>}
          </div>
        ) : (
          scenarios.map((scenarioData) => (
            <ScenarioMultipliersGrid
              key={scenarioData.scenario.id}
              scenario={scenarioData.scenario}
              multipliers={scenarioData.multipliers}
              canEdit={canCreate}
            />
          ))
        )}
      </div>
    </div>
  )
}
