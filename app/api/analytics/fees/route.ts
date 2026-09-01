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
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminSupabaseClient()

    // For development: extract org_id from query param
    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!orgId) {
      return NextResponse.json({ error: 'org_id required' }, { status: 400 })
    }
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
