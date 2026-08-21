import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, buildCashFlowDays } from '@/lib/cash-flow/engine'
import { shiftDateString } from '@/lib/cash-flow/dates'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam } from '@/lib/integrations/date'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scenarioId: string }> }
) {
  const resolvedParams = await params
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const admin = createAdminSupabaseClient()

    // Load scenario and verify it belongs to this org
    const { data: scenario, error: scenarioError } = await admin
      .from('payment_scenarios')
      .select('*')
      .eq('id', resolvedParams.scenarioId)
      .eq('org_id', member.orgId)
      .single()

    if (scenarioError || !scenario)
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })

    // Load scenario adjustments
    const { data: adjustments, error: adjError } = await admin
      .from('scenario_adjustments')
      .select('ap_id, days_delta, percentage')
      .eq('scenario_id', resolvedParams.scenarioId)

    if (adjError) throw new Error(`Failed to load adjustments: ${adjError.message}`)

    // Load baseline cash flow (no adjustments)
    const today = toLocalDateParam(new Date())
    const from = shiftDateString(today, -30)
    const to = shiftDateString(today, 90)

    const baselineEntries = await loadCashFlowEntries(member.orgId)
    const baselineDays = await buildCashFlowDays(member.orgId, from, to, baselineEntries)

    // Calculate baseline metrics
    const baselineMetrics = calculateMetrics(baselineDays, today)

    // Apply scenario adjustments to entries
    const adjustmentMap = new Map<string, { daysDelta: number; percentage: number }>()
    for (const adj of adjustments ?? []) {
      adjustmentMap.set(adj.ap_id, { daysDelta: adj.days_delta, percentage: adj.percentage })
    }

    const adjustedEntries = baselineEntries.map((entry) => {
      if (entry.origin !== 'ap') return entry

      const adjustment = adjustmentMap.get(entry.sourceId)
      if (!adjustment) return entry

      // Apply days delta
      const currentDate = new Date(entry.date)
      currentDate.setDate(currentDate.getDate() + adjustment.daysDelta)
      const newDate = currentDate.toISOString().split('T')[0]

      // Apply percentage (split remaining amount)
      const adjustedAmount = entry.amount * (adjustment.percentage / 100)

      return {
        ...entry,
        date: newDate,
        amount: adjustedAmount,
      }
    })

    const adjustedDays = await buildCashFlowDays(member.orgId, from, to, adjustedEntries)

    // Calculate adjusted metrics
    const adjustedMetrics = calculateMetrics(adjustedDays, today)

    // Determine if this is an improvement
    const melhoria =
      adjustedMetrics.saldoMinimo > baselineMetrics.saldoMinimo ||
      adjustedMetrics.diasNegativos < baselineMetrics.diasNegativos

    return NextResponse.json({
      impact: {
        saldoMinimoAntes: baselineMetrics.saldoMinimo,
        saldoMinimoDepois: adjustedMetrics.saldoMinimo,
        dataSaldoMinimo: baselineMetrics.dataSaldoMinimo,
        diasNegativosAntes: baselineMetrics.diasNegativos,
        diasNegativosDepois: adjustedMetrics.diasNegativos,
        melhoria,
      },
    })
  } catch (error) {
    console.error('Error calculating scenario impact:', error)
    return NextResponse.json({ error: 'Failed to calculate impact' }, { status: 500 })
  }
}

/**
 * Calculate metrics from cash flow days:
 * - Saldo mínimo: lowest balance across all days
 * - Data do saldo mínimo: when it occurred
 * - Dias negativos: count of days with balance < 0
 */
function calculateMetrics(
  days: any[],
  today: string
): { saldoMinimo: number; dataSaldoMinimo: string; diasNegativos: number } {
  let saldoMinimo = Infinity
  let dataSaldoMinimo = today
  let diasNegativos = 0

  for (const day of days) {
    if (day.saldoFinal != null) {
      if (day.saldoFinal < saldoMinimo) {
        saldoMinimo = day.saldoFinal
        dataSaldoMinimo = day.date
      }
      if (day.saldoFinal < 0) {
        diasNegativos++
      }
    }
  }

  return {
    saldoMinimo: saldoMinimo === Infinity ? 0 : saldoMinimo,
    dataSaldoMinimo,
    diasNegativos,
  }
}
