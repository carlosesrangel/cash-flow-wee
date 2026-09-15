/**
 * GET /api/analytics/fees
 *
 * Return Taxas_12M - 12-month historical fee rates
 * Dimensions: payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan
 *
 * Query params:
 * - payment_type (optional): filter to specific type
 * - min_confiabilidade (optional): ALTA, MEDIA, BAIXA
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getCurrentMember } from '@/lib/auth/session'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestedOrgId = req.nextUrl.searchParams.get('org_id')
  if (requestedOrgId && requestedOrgId !== member.orgId) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  try {
    const admin = createAdminSupabaseClient()

    const orgId = member.orgId
    const searchParams = req.nextUrl.searchParams
    const paymentTypeFilter = searchParams.get('payment_type')
    const minConfiabilidade = searchParams.get('min_confiabilidade')

    // Load fee rates
    let query = admin
      .from('sumup_fee_rates_12m')
      .select('*')
      .eq('org_id', orgId)
      .order('pct_valor_12m', { ascending: false })

    if (paymentTypeFilter) {
      query = query.eq('payment_type', paymentTypeFilter.toUpperCase())
    }

    const { data: rates, error } = await query

    if (error) {
      throw error
    }

    // Filter by confidence if needed
    let filtered = rates || []
    if (minConfiabilidade) {
      const confidenceOrder = { ALTA: 3, MEDIA: 2, BAIXA: 1 }
      const minLevel = confidenceOrder[minConfiabilidade as keyof typeof confidenceOrder] || 0
      filtered = filtered.filter((r) => {
        const level = confidenceOrder[r.confiabilidade as keyof typeof confidenceOrder] || 0
        return level >= minLevel
      })
    }

    return NextResponse.json({
      success: true,
      count: filtered.length,
      data: filtered,
      metadata: {
        org_id: orgId,
        inicio_janela: filtered[0]?.inicio_janela || null,
        fim_janela: filtered[0]?.fim_janela || null,
      },
    })
  } catch (error) {
    console.error('Failed to load fee rates:', error)
    return NextResponse.json({ error: 'Failed to load fee rates' }, { status: 500 })
  }
}
