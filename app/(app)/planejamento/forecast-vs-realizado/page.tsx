import Link from 'next/link'
import { getCurrentMember } from '@/lib/auth/session'
import { loadAllVersions, loadVersionEntries, loadScenarios, loadRealizadoByMonth } from '@/lib/forecast/engine'
import { compareForecastToActual } from '@/lib/forecast/compare'
import { ForecastReport } from '@/components/forecast/forecast-report'
import { ReportControls } from './controls'

export default async function ForecastVsRealizadoPage({
  searchParams,
}: {
  searchParams: Promise<{ versionId?: string; scenarioId?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o relatório.</p>
  }

  const versions = await loadAllVersions(member.orgId)
  if (versions.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Forecast vs Realizado</h1>
          <Link href="/planejamento" className="text-sm text-neutral-600 underline">
            Voltar ao Planejamento
          </Link>
        </div>
        <p className="text-sm text-neutral-500">Nenhuma versão de forecast cadastrada ainda.</p>
      </div>
    )
  }

  const { versionId, scenarioId } = await searchParams
  let selectedVersionId = versionId
  if (!selectedVersionId || !versions.find((v) => v.id === selectedVersionId)) {
    selectedVersionId = versions[0].id
  }

  // Load the forecast data
  const baseEntries = await loadVersionEntries(member.orgId, selectedVersionId)
  if (baseEntries.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Forecast vs Realizado</h1>
          <Link href="/planejamento" className="text-sm text-neutral-600 underline">
            Voltar ao Planejamento
          </Link>
        </div>
        <p className="text-sm text-neutral-500">Nenhuma entrada de forecast nesta versão.</p>
      </div>
    )
  }

  // Apply scenario if specified
  let forecastEntries = baseEntries
  if (scenarioId) {
    const { applyScenario } = await import('@/lib/forecast/scenarios')
    const scenarios = await loadScenarios(member.orgId)
    const scenario = scenarios.find((s) => s.scenario.id === scenarioId)
    if (scenario) {
      forecastEntries = applyScenario(baseEntries, scenario.multipliers)
    }
  }

  // Load actual revenue
  const realizado = await loadRealizadoByMonth(member.orgId)

  // Get today's date in São Paulo timezone
  const now = new Date()
  const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const today = { ano: brazilTime.getFullYear(), mes: brazilTime.getMonth() + 1 }

  // Generate report
  const report = compareForecastToActual(forecastEntries, realizado, today)

  const scenarios = await loadScenarios(member.orgId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Forecast vs Realizado</h1>
        <Link href="/planejamento" className="text-sm text-neutral-600 underline">
          Voltar ao Planejamento
        </Link>
      </div>

      <ReportControls
        versions={versions}
        scenarios={scenarios}
        selectedVersionId={selectedVersionId}
        selectedScenarioId={scenarioId}
      />

      <ForecastReport rows={report} />
    </div>
  )
}
