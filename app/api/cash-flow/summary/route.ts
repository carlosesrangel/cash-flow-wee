import { loadCanonicalCashFlow } from '@/lib/ledger/canonical-cash-flow'
import { buildCashFlowDays } from '@/lib/cash-flow/engine'
import { paymentPeriodSchema } from '@/lib/payments/period'
/**
 * GET /api/cash-flow/summary
 *
 * Cash flow summary with KPI calculations
 *
 * Query params:
 * - period: day|month|year (default: month)
 * - from_date: ISO date start (default: 90 days ago)
 * - to_date: ISO date end (default: today)
 * - include_projected: boolean (default: false - only actual+scheduled)
 *
 * Returns: cash flow per period with KPI metrics
 */

import { getCurrentMember } from '@/lib/auth/session'
import { NextRequest, NextResponse } from 'next/server'

interface CashFlowPeriod {
  period: string
  entradas: number
  saidas: number
  saldo: number
  saldo_acumulado: number | null
  qtd_entradas: number
  qtd_saidas: number
  ticket_medio_entrada?: number
  taxa_saidas_entrada?: number
}

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestedOrgId = req.nextUrl.searchParams.get('org_id')
  if (requestedOrgId && requestedOrgId !== member.orgId) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  try {
    const orgId = member.orgId
    const searchParams = req.nextUrl.searchParams
    const period = searchParams.get('period') || 'month'
    const toDateStr = searchParams.get('to_date') || new Date().toISOString().split('T')[0]
    const includeProjected = searchParams.get('include_projected') === 'true'

    // Default from_date: 90 days ago
    let defaultFromDate = new Date()
    defaultFromDate.setDate(defaultFromDate.getDate() - 90)
    const fromDate = searchParams.get('from_date') || defaultFromDate.toISOString().split('T')[0]

    if (!paymentPeriodSchema.safeParse({ from: fromDate, to: toDateStr }).success || !['day','month','year'].includes(period)) return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
    const allEntries = (await loadCanonicalCashFlow(orgId)).filter(e => includeProjected || e.bucket !== 'projetado')
    const entries = allEntries.filter(e => e.date >= fromDate && e.date <= toDateStr).map(e => ({ ...e, event_date: e.date }))
    const days = await buildCashFlowDays(orgId, fromDate, toDateStr, allEntries)
    const closing = new Map<string, number | null>()
    for (const day of days) closing.set(period === 'month' ? day.date.slice(0, 7) : period === 'year' ? day.date.slice(0, 4) : day.date, day.saldoFinal)

    // Aggregate by period
    const byPeriod = new Map<string, { entradas: number; saidas: number; qtd_entradas: number; qtd_saidas: number }>()

    for (const entry of entries || []) {
      let periodKey = entry.event_date
      if (period === 'month') {
        periodKey = entry.event_date.substring(0, 7) // YYYY-MM
      } else if (period === 'year') {
        periodKey = entry.event_date.substring(0, 4) // YYYY
      }

      if (!byPeriod.has(periodKey)) {
        byPeriod.set(periodKey, { entradas: 0, saidas: 0, qtd_entradas: 0, qtd_saidas: 0 })
      }

      const data = byPeriod.get(periodKey)!
      if (entry.direction === 'entrada') {
        data.entradas += entry.amount
        data.qtd_entradas += 1
      } else {
        data.saidas += entry.amount
        data.qtd_saidas += 1
      }
    }

    for (const key of closing.keys()) if (!byPeriod.has(key)) byPeriod.set(key, { entradas: 0, saidas: 0, qtd_entradas: 0, qtd_saidas: 0 })
    // Sort periods
    const periods = Array.from(byPeriod.keys()).sort()

    // Build result with running balance
    const result: CashFlowPeriod[] = []
    for (const p of periods) {
      const data = byPeriod.get(p)!
      const saldo = data.entradas - data.saidas

      result.push({
        period: p,
        entradas: Math.round(data.entradas * 100) / 100,
        saidas: Math.round(data.saidas * 100) / 100,
        saldo: Math.round(saldo * 100) / 100,
        saldo_acumulado: closing.get(p) ?? null,
        qtd_entradas: data.qtd_entradas,
        qtd_saidas: data.qtd_saidas,
        ticket_medio_entrada: data.qtd_entradas > 0 ? Math.round((data.entradas / data.qtd_entradas) * 100) / 100 : 0,
        taxa_saidas_entrada: data.entradas > 0 ? Math.round((data.saidas / data.entradas) * 10000) / 100 : 0,
      })
    }

    // Calculate KPIs
    const totalEntradas = result.reduce((s, p) => s + p.entradas, 0)
    const totalSaidas = result.reduce((s, p) => s + p.saidas, 0)
    const kpis = {
      total_entradas: Math.round(totalEntradas * 100) / 100,
      total_saidas: Math.round(totalSaidas * 100) / 100,
      saldo_final: days.at(-1)?.saldoFinal ?? null,
      taxa_saidas_media: totalEntradas > 0 ? Math.round((totalSaidas / totalEntradas) * 10000) / 100 : 0,
      ticket_medio: result.some(p => p.qtd_entradas > 0) ? Math.round((totalEntradas / result.reduce((s, p) => s + p.qtd_entradas, 0)) * 100) / 100 : 0,
      periodos: result.length,
    }

    return NextResponse.json({
      success: true,
      org_id: orgId,
      period_type: period,
      kpis,
      periods: result,
      filters: {
        from_date: fromDate,
        to_date: toDateStr,
        include_projected: includeProjected,
      },
      metadata: {
        calculation_version: 'FINANCIAL_MODEL_V2_EXCEL_PARITY',
      },
    })
  } catch (error) {
    console.error('Failed to query cash flow summary:', error)
    return NextResponse.json({ error: 'Failed to query cash flow summary' }, { status: 500 })
  }
}
