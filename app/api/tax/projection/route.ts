/**
 * GET /api/tax/projection
 *
 * Project Simples Nacional tax for months
 *
 * FIXED FORMULA: (RBT12 * Nominal - Deduction) / RBT12
 *
 * Query params:
 * - months: number of months to project (default 12)
 * - from_date: ISO date to start (default today)
 *
 * Returns:
 * - per-month tax calculations with:
 *   * RBT12 (rolling 12-month revenue)
 *   * Effective rate
 *   * Imposto projetado
 *   * Vencimento (due date = 20th of next month)
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getAuth } from '@supabase/auth-helpers-nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { calculateEffectiveSimplesTaxRate } from '@/lib/tax/simples-nacional'

export async function GET(req: NextRequest) {
  try {
    const { user } = await getAuth(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminSupabaseClient()

    // Get user's org
    const { data: member } = await admin
      .from('organization_members')
      .select('org_id')
      .eq('profile_id', user.id)
      .limit(1)
      .maybeSingle()

    if (!member?.org_id) {
      return NextResponse.json({ error: 'No organization' }, { status: 400 })
    }

    const orgId = member.org_id
    const searchParams = req.nextUrl.searchParams
    const monthsToProject = parseInt(searchParams.get('months') || '12')
    const fromDateStr = searchParams.get('from_date') || new Date().toISOString().split('T')[0]
    const fromDate = new Date(fromDateStr)

    // Get organization timezone
    const { data: org } = await admin
      .from('organizations')
      .select('timezone')
      .eq('id', orgId)
      .maybeSingle()

    const timezone = org?.timezone || 'America/Sao_Paulo'

    // Load actual revenue for RBT12 calculation
    // Using SumUp + Olist historical data
    const { data: sumupRevenue } = await admin
      .from('sumup_transactions')
      .select('timestamp_utc, amount')
      .eq('org_id', orgId)
      .filter('status', 'eq', 'SUCCESSFUL')
      .filter('amount', 'gt', 0)
      .gte('timestamp_utc', new Date(fromDate.getFullYear() - 1, fromDate.getMonth(), 1).toISOString())

    // Build RBT12 map by month
    const rbt12ByMonth = new Map<string, number>()
    if (sumupRevenue) {
      for (let i = 0; i < monthsToProject; i++) {
        const targetMonth = new Date(fromDate)
        targetMonth.setMonth(targetMonth.getMonth() + i)

        // Calculate RBT12 as rolling 12 months prior to targetMonth
        let rbt12 = 0
        for (let j = 0; j < 12; j++) {
          const checkMonth = new Date(targetMonth)
          checkMonth.setMonth(checkMonth.getMonth() - (11 - j))

          const monthStr = `${checkMonth.getFullYear()}-${String(checkMonth.getMonth() + 1).padStart(2, '0')}`
          const monthRevenue = sumupRevenue
            .filter((r) => {
              const rDate = new Date(r.timestamp_utc)
              return (
                rDate.getFullYear() === checkMonth.getFullYear() &&
                rDate.getMonth() === checkMonth.getMonth()
              )
            })
            .reduce((sum, r) => sum + (r.amount || 0), 0)

          rbt12 += monthRevenue
        }

        const monthKey = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, '0')}`
        rbt12ByMonth.set(monthKey, rbt12)
      }
    }

    // Project taxes
    const projections = []
    for (let i = 0; i < monthsToProject; i++) {
      const month = new Date(fromDate)
      month.setMonth(month.getMonth() + i)

      const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
      const rbt12 = rbt12ByMonth.get(monthKey) || 0

      const taxInfo = calculateEffectiveSimplesTaxRate(rbt12, month.getFullYear())

      // Get actual/forecast revenue for this month
      // TODO: integrate with actual revenue + forecast
      const receita_mes = 0 // placeholder

      const imposto = receita_mes * taxInfo.aliquota_efetiva

      const vencimento = new Date(month)
      vencimento.setMonth(vencimento.getMonth() + 1)
      vencimento.setDate(20)

      projections.push({
        competencia_ano: month.getFullYear(),
        competencia_mes: month.getMonth() + 1,
        competencia_str: monthKey,
        receita_mes: Math.round(receita_mes * 100) / 100,
        rbt12: Math.round(rbt12 * 100) / 100,
        faixa: taxInfo.faixa,
        aliquota_nominal: taxInfo.aliquota_nominal,
        parcela_deduzir: taxInfo.parcela_deduzir,
        aliquota_efetiva: Math.round(taxInfo.aliquota_efetiva * 10000) / 10000, // 4 decimals for rates
        imposto_projetado: Math.round(imposto * 100) / 100,
        data_vencimento: vencimento.toISOString().split('T')[0],
        status: 'PROJETADO',
      })
    }

    return NextResponse.json({
      success: true,
      count: projections.length,
      projections,
      summary: {
        imposto_total_12m: Math.round(projections.reduce((s, p) => s + p.imposto_projetado, 0) * 100) / 100,
        receita_total_12m: Math.round(projections.reduce((s, p) => s + p.receita_mes, 0) * 100) / 100,
        aliquota_media_efetiva: projections.length > 0
          ? Math.round((projections.reduce((s, p) => s + p.aliquota_efetiva, 0) / projections.length) * 10000) / 10000
          : 0,
      },
      metadata: {
        org_id: orgId,
        timezone,
        calculation_version: 'FINANCIAL_MODEL_V2_EXCEL_PARITY',
        formula: '(RBT12 * Aliquota_Nominal - Parcela_Deduzir) / RBT12',
      },
    })
  } catch (error) {
    console.error('Failed to project tax:', error)
    return NextResponse.json({ error: 'Failed to project tax' }, { status: 500 })
  }
}
