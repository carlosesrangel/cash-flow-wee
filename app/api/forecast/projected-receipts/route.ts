/**
 * POST /api/forecast/projected-receipts
 *
 * Transform forecast entries into projected cash receipts
 *
 * CRITICAL: Forecast Revenue != Cash Receipts
 *
 * Pipeline:
 * Receita Projetada → Sazonalidade → Mix → Taxas → Perfil → Recebimento Líquido
 *
 * Request body:
 * {
 *   version_id: string // forecast version
 * }
 *
 * Returns array of projected receipts with:
 * - data_venda: when sale occurs
 * - data_recebimento: when money arrives
 * - valor_bruto: gross receipt amount
 * - fee_projetado: projected fee
 * - valor_liquido: net receipt
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getAuth } from '@supabase/auth-helpers-nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { transformForecastToReceipts, validateForecastTransformInvariant } from '@/lib/forecast/transform'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

export async function POST(req: NextRequest) {
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
    const body = await req.json()
    const versionId = body.version_id as string

    if (!versionId) {
      return NextResponse.json({ error: 'version_id required' }, { status: 400 })
    }

    // Verify version belongs to org
    const { data: version, error: versionError } = await admin
      .from('forecast_versions')
      .select('id')
      .eq('id', versionId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (versionError || !version) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 })
    }

    // Load forecast entries
    const { data: entries, error: entriesError } = await admin
      .from('forecast_entries')
      .select('ano, mes, receita')
      .eq('version_id', versionId)
      .order('ano')
      .order('mes')

    if (entriesError || !entries) {
      return NextResponse.json({ error: 'Failed to load forecast' }, { status: 500 })
    }

    // Transform to MonthlyValue format
    const forecast: MonthlyValue[] = entries.map((e) => ({
      ano: e.ano,
      mes: e.mes,
      value: e.receita,
    }))

    // Transform forecast to receipts
    const receipts = await transformForecastToReceipts(admin, orgId, forecast)

    // Validate invariants
    const invariants = []
    for (const monthData of forecast) {
      const isValid = validateForecastTransformInvariant(monthData, receipts)
      invariants.push({
        ano: monthData.ano,
        mes: monthData.mes,
        receita: monthData.value,
        valida: isValid,
      })
    }

    // Group by receipt month for summary
    const byReceiptMonth = new Map<string, { bruto: number; fee: number; liquido: number; qtd: number }>()
    for (const receipt of receipts) {
      const monthKey = `${receipt.data_recebimento.getFullYear()}-${String(receipt.data_recebimento.getMonth() + 1).padStart(2, '0')}`
      const existing = byReceiptMonth.get(monthKey) || { bruto: 0, fee: 0, liquido: 0, qtd: 0 }
      existing.bruto += receipt.receita_projetada_bruta
      existing.fee += receipt.fee_projetado
      existing.liquido += receipt.recebimento_liquido_projetado
      existing.qtd += 1
      byReceiptMonth.set(monthKey, existing)
    }

    return NextResponse.json({
      success: true,
      forecast_version: versionId,
      count_entries: forecast.length,
      count_receipts: receipts.length,
      summary: Object.fromEntries(byReceiptMonth),
      receipts: receipts.slice(0, 100), // First 100 for response size
      total_bruto: receipts.reduce((s, r) => s + r.receita_projetada_bruta, 0),
      total_liquido: receipts.reduce((s, r) => s + r.recebimento_liquido_projetado, 0),
      invariants,
      metadata: {
        org_id: orgId,
        calculation_version: 'FINANCIAL_MODEL_V2_EXCEL_PARITY',
      },
    })
  } catch (error) {
    console.error('Failed to project receipts:', error)
    return NextResponse.json({ error: 'Failed to project receipts' }, { status: 500 })
  }
}
