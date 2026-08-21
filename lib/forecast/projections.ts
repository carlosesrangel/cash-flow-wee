/**
 * Sales projections engine: translates forecast_entries (monthly revenue targets)
 * into daily/detailed sales transactions based on sales_mix assumptions.
 *
 * Key flows:
 * 1. Load forecast_entries + sales_mix for a version
 * 2. Distribute monthly revenue across 3 decades (1-10, 11-20, 21-30)
 * 3. Apply payment method mix (débito, crédito, pix, dinheiro)
 * 4. Calculate settlement dates using dias_recebimento
 * 5. Generate accounts_receivable_projected entries
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type ViewRow = Record<string, unknown>

export interface SalesMixEntry {
  modalidade: string
  percentual: number
  parcelas_media: number
  taxa_cartao: number
  dias_recebimento: number
}

export interface ForecastEntry {
  ano: number
  mes: number
  receita: number
}

export interface ProjectedAREntry {
  version_id: string
  org_id: string
  ano_venda: number
  mes_venda: number
  dia_venda: number
  data_vencimento: string // YYYY-MM-DD
  modalidade: string
  valor_bruto: number
  taxa_aplicada: number
  valor_liquido: number
  parcelas: number
}

/**
 * Generate projected AR entries from forecast targets + sales mix.
 * Distributes revenue across 3 decades and payment methods.
 */
export async function generateProjectedAR(
  versionId: string,
  orgId: string,
  forecastEntries: ForecastEntry[],
  salesMix: SalesMixEntry[],
): Promise<ProjectedAREntry[]> {
  const entries: ProjectedAREntry[] = []

  // Decade distribution: uniform across 3 periods
  const decadeStarts = [1, 11, 21]
  const decadeShare = 1 / 3

  for (const forecast of forecastEntries) {
    for (const decade of decadeStarts) {
      // Distribute within each decade (use mid-point: day 5, 15, 25)
      const diaVenda = decade === 1 ? 5 : decade === 11 ? 15 : 25
      const decadeRevenue = forecast.receita * decadeShare

      // Apply payment method mix
      for (const mix of salesMix) {
        const mixRevenue = decadeRevenue * (mix.percentual / 100)
        const tax = mixRevenue * mix.taxa_cartao
        const liquidRevenue = mixRevenue - tax

        // Calculate settlement date
        const dataVendaDate = new Date(forecast.ano, forecast.mes - 1, diaVenda)
        const dataVencimentoDate = new Date(dataVendaDate)
        dataVencimentoDate.setDate(dataVencimentoDate.getDate() + mix.dias_recebimento)

        const dataVencimento = dataVencimentoDate.toISOString().split('T')[0]

        entries.push({
          version_id: versionId,
          org_id: orgId,
          ano_venda: forecast.ano,
          mes_venda: forecast.mes,
          dia_venda: diaVenda,
          data_vencimento: dataVencimento,
          modalidade: mix.modalidade,
          valor_bruto: Math.round(mixRevenue * 100) / 100,
          taxa_aplicada: mix.taxa_cartao,
          valor_liquido: Math.round(liquidRevenue * 100) / 100,
          parcelas: Math.round(mix.parcelas_media),
        })
      }
    }
  }

  return entries
}

/**
 * Load forecast entries for a version
 */
export async function loadForecastEntriesForVersion(
  versionId: string,
): Promise<ForecastEntry[]> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('forecast_entries')
    .select('ano, mes, receita')
    .eq('version_id', versionId)
    .order('ano, mes')

  if (error) throw new Error(`loadForecastEntriesForVersion: ${error.message}`)
  return (data ?? []).map((row: ViewRow) => ({
    ano: row.ano as number,
    mes: row.mes as number,
    receita: row.receita as number,
  }))
}

/**
 * Load sales mix for a version
 */
export async function loadSalesMixForVersion(
  versionId: string,
): Promise<SalesMixEntry[]> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('sales_mix')
    .select('modalidade, percentual, parcelas_media, taxa_cartao, dias_recebimento')
    .eq('version_id', versionId)

  if (error) throw new Error(`loadSalesMixForVersion: ${error.message}`)
  return (data ?? []).map((row: ViewRow) => ({
    modalidade: row.modalidade as string,
    percentual: row.percentual as number,
    parcelas_media: row.parcelas_media as number,
    taxa_cartao: row.taxa_cartao as number,
    dias_recebimento: row.dias_recebimento as number,
  }))
}

/**
 * Populate accounts_receivable_projected for a version
 */
export async function populateProjectedAR(versionId: string, orgId: string): Promise<number> {
  const admin = createAdminSupabaseClient()

  // Load dependencies
  const forecasts = await loadForecastEntriesForVersion(versionId)
  const mix = await loadSalesMixForVersion(versionId)

  if (!forecasts.length || !mix.length) {
    console.warn('⚠️  No forecast entries or sales mix found for version', versionId)
    return 0
  }

  // Generate AR entries
  const arEntries = await generateProjectedAR(versionId, orgId, forecasts, mix)

  if (arEntries.length === 0) {
    console.warn('⚠️  No AR entries generated for version', versionId)
    return 0
  }

  // Insert into DB
  const { error } = await admin.from('accounts_receivable_projected').insert(arEntries)
  if (error) throw new Error(`populateProjectedAR insert: ${error.message}`)

  console.log(`✅ Generated ${arEntries.length} projected AR entries for version ${versionId}`)
  return arEntries.length
}

/**
 * Get summary of projected AR by month
 */
export async function getProjectedARSummary(
  versionId: string,
): Promise<{month: string; value_total: number; parcelas: number; payment_methods: number}[]> {
  const admin = createAdminSupabaseClient()

  const { data, error } = await admin
    .from('accounts_receivable_projected')
    .select('data_vencimento, valor_liquido, parcelas, modalidade')
    .eq('version_id', versionId)
    .order('data_vencimento')

  if (error) throw new Error(`getProjectedARSummary: ${error.message}`)

  const byMonth = new Map<
    string,
    {total: number; parcelas: Set<number>; methods: Set<string>}
  >()

  for (const row of data ?? []) {
    const month = (row.data_vencimento as string).substring(0, 7) // YYYY-MM
    if (!byMonth.has(month)) {
      byMonth.set(month, {total: 0, parcelas: new Set(), methods: new Set()})
    }

    const summary = byMonth.get(month)!
    summary.total += row.valor_liquido
    summary.parcelas.add(row.parcelas)
    summary.methods.add(row.modalidade)
  }

  return Array.from(byMonth.entries())
    .map(([month, summary]) => ({
      month,
      value_total: Math.round(summary.total * 100) / 100,
      parcelas: Math.max(...summary.parcelas),
      payment_methods: summary.methods.size,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}
