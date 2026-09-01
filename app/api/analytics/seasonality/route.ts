/**
 * GET /api/analytics/seasonality
 *
 * Return Sazonalidade_3Faixas - 3-band intra-month distribution
 *
 * Query params:
 * - mes (optional): 1-12
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getAuth } from '@supabase/auth-helpers-nextjs'
import { NextRequest, NextResponse } from 'next/server'

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
    const mesFilter = searchParams.get('mes') ? parseInt(searchParams.get('mes')!) : null

    // Load seasonality
    let query = admin
      .from('sumup_seasonality_3bands_12m')
      .select('*')
      .eq('org_id', orgId)
      .order('mes_historico')
      .order('faixa')

    if (mesFilter) {
      query = query.eq('mes_historico', mesFilter)
    }

    const { data: seasonality, error } = await query

    if (error) {
      throw error
    }

    // Group by month
    const byMonth = new Map<number, any[]>()
    for (const row of seasonality || []) {
      if (!byMonth.has(row.mes_historico)) {
        byMonth.set(row.mes_historico, [])
      }
      byMonth.get(row.mes_historico)!.push({
        faixa: row.faixa,
        faixa_label: row.faixa === 1 ? '1-9' : row.faixa === 2 ? '10-19' : '20-31',
        peso_faixa: row.peso_faixa,
        dia_referencia: row.dia_referencia,
        fonte: row.calculado_em ? 'CALCULADO' : 'PADRAO',
      })
    }

    // Check invariants
    const invariants = []
    for (const [mes, bandas] of byMonth) {
      const somaPesos = bandas.reduce((s, b) => s + (b.peso_faixa || 0), 0)
      invariants.push({
        mes,
        soma_pesos: somaPesos,
        valida: Math.abs(somaPesos - 1.0) < 0.01,
      })
    }

    return NextResponse.json({
      success: true,
      data: Object.fromEntries(byMonth),
      invariants,
      metadata: {
        org_id: orgId,
        total_months: byMonth.size,
      },
    })
  } catch (error) {
    console.error('Failed to load seasonality:', error)
    return NextResponse.json({ error: 'Failed to load seasonality' }, { status: 500 })
  }
}
