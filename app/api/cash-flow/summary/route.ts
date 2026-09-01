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

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

interface CashFlowPeriod {
  period: string
  entradas: number
  saidas: number
  saldo: number
  saldo_acumulado: number
  qtd_entradas: number
  qtd_saidas: number
  ticket_medio_entrada?: number
  taxa_saidas_entrada?: number
}

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminSupabaseClient()

    // For development: extract org_id from query param
    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!orgId) {
      return NextResponse.json({ error: 'org_id required' }, { status: 400 })
    }
    const searchParams = req.nextUrl.searchParams
    const period = searchParams.get('period') || 'month'
    const toDateStr = searchParams.get('to_date') || new Date().toISOString().split('T')[0]
    const includeProjected = searchParams.get('include_projected') === 'true'

    // Default from_date: 90 days ago
    let defaultFromDate = new Date()
    defaultFromDate.setDate(defaultFromDate.getDate() - 90)
    const fromDate = searchParams.get('from_date') || defaultFromDate.toISOString().split('T')[0]

    // Load ledger entries
    const statuses = includeProjected ? ['actual', 'scheduled', 'projected'] : ['actual', 'scheduled']
    const { data: entries, error } = await admin
      .from('financial_ledger')
      .select('event_date, amount, direction')
      .eq('org_id', orgId)
      .in('status', statuses)
      .gte('event_date', fromDate)
      .lte('event_date', toDateStr)
      .order('event_date', { ascending: true })

    if (error) {
      throw error
    }

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

    // Sort periods
    const periods = Array.from(byPeriod.keys()).sort()

    // Build result with running balance
    let acumulado = 0
    const result: CashFlowPeriod[] = []
    for (const p of periods) {
      const data = byPeriod.get(p)!
      const saldo = data.entradas - data.saidas
      acumulado += saldo

      result.push({
        period: p,
        entradas: Math.round(data.entradas * 100) / 100,
        saidas: Math.round(data.saidas * 100) / 100,
        saldo: Math.round(saldo * 100) / 100,
        saldo_acumulado: Math.round(acumulado * 100) / 100,
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
      saldo_final: Math.round((totalEntradas - totalSaidas) * 100) / 100,
      taxa_saidas_media: totalEntradas > 0 ? Math.round((totalSaidas / totalEntradas) * 10000) / 100 : 0,
      ticket_medio: result.length > 0 ? Math.round((totalEntradas / result.reduce((s, p) => s + p.qtd_entradas, 0)) * 100) / 100 : 0,
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
