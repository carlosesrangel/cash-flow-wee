import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentMember } from '@/lib/auth/session'
import { loadVersionEntries, loadScenarios, loadRealizadoByMonth, loadAllVersions } from '@/lib/forecast/engine'
import { compareForecastToActual } from '@/lib/forecast/compare'
import { applyScenario } from '@/lib/forecast/scenarios'
import type { ForecastVsRealizadoRow } from '@/lib/forecast/compare'

const querySchema = z.object({
  versionId: z.string().uuid().optional(),
  scenarioId: z.string().uuid().optional(),
})

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const query = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!query.success) {
    return NextResponse.json({ error: 'Invalid query parameters', details: query.error.flatten() }, { status: 400 })
  }

  try {
    // Default to current version if not specified
    let versionId = query.data.versionId
    if (!versionId) {
      const versions = await loadAllVersions(member.orgId)
      if (versions.length === 0) {
        return NextResponse.json({ error: 'Nenhuma versão de forecast encontrada' }, { status: 404 })
      }
      versionId = versions[0].id
    } else {
      // Verify the requested version belongs to this org
      const versions = await loadAllVersions(member.orgId)
      if (!versions.find((v) => v.id === versionId)) {
        return NextResponse.json({ error: 'Versão não encontrada' }, { status: 404 })
      }
    }

    // Load base entries (100% forecast)
    const baseEntries = await loadVersionEntries(member.orgId, versionId)
    if (baseEntries.length === 0) {
      return NextResponse.json({ error: 'Nenhuma entrada de forecast nesta versão' }, { status: 404 })
    }

    // Apply scenario if specified, or use 100% (base)
    let forecastEntries = baseEntries
    if (query.data.scenarioId) {
      const scenarios = await loadScenarios(member.orgId)
      const scenario = scenarios.find((s) => s.scenario.id === query.data.scenarioId)
      if (!scenario) {
        return NextResponse.json({ error: 'Cenário não encontrado' }, { status: 404 })
      }
      forecastEntries = applyScenario(baseEntries, scenario.multipliers)
    }

    // Load actual revenue
    const realizado = await loadRealizadoByMonth(member.orgId)

    // Get today's date in São Paulo timezone to determine null vs 0
    const now = new Date()
    const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const today = { ano: brazilTime.getFullYear(), mes: brazilTime.getMonth() + 1 }

    // Compare
    const report = compareForecastToActual(forecastEntries, realizado, today)

    return NextResponse.json({ months: report })
  } catch (error) {
    console.error('Error generating forecast report:', error)
    return NextResponse.json({ error: 'Erro ao gerar relatório de forecast' }, { status: 500 })
  }
}
