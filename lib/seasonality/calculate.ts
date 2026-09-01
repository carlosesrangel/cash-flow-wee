/**
 * Financial Model V2: Seasonality Calculation (Sazonalidade_3Faixas)
 *
 * Implements parity with legacy Excel Power Query: Sazonalidade_Projetada_3Faixas
 *
 * 3-band intra-month seasonality distribution:
 * - Band 1: days 1-9
 * - Band 2: days 10-19
 * - Band 3: days 20-end of month
 *
 * Each forecast month uses one of:
 * 1. Same month from previous year (historical)
 * 2. Most recent same month (historical)
 * 3. Global 12-month average
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type SeasonalityBand = 1 | 2 | 3

export type SeasonalityFactor = {
  faixa: SeasonalityBand
  faixaMes: string // "1-9", "10-19", "20-31"
  diaReferencia: 1 | 10 | 20
  pesoFaixa: number // 0.0 to 1.0
  fonteSeasonalidade: 'ANO_ANTERIOR' | 'MES_RECENTE' | 'PERFIL_GLOBAL'
  anoHistoricoUtilizado: number
  receita_projetada_faixa: number
}

export type SeasonalityProfile = {
  bandas: SeasonalityFactor[]
  receita_projetada_total: number
  invariante_check: {
    soma_pesos: number // should be ~1.0
    soma_receitas: number // should equal receita_projetada_total
    valida: boolean
  }
}

/**
 * Get band and reference day for a date
 */
export function getBandFromDate(day: number): SeasonalityBand {
  if (day <= 9) return 1
  if (day <= 19) return 2
  return 3
}

/**
 * Get reference day for a band
 */
export function getReferenceDay(banda: SeasonalityBand): 1 | 10 | 20 {
  switch (banda) {
    case 1:
      return 1
    case 2:
      return 10
    case 3:
      return 20
  }
}

/**
 * Get band label
 */
export function getBandLabel(banda: SeasonalityBand): string {
  switch (banda) {
    case 1:
      return '1-9'
    case 2:
      return '10-19'
    case 3:
      return '20-31'
  }
}

/**
 * Calculate seasonality weight for a given month and band
 * Fallback order:
 * 1. Same month previous year
 * 2. Most recent same month in history
 * 3. Global 12-month average
 */
export async function getSeasonalityWeight(
  admin: AdminClient,
  orgId: string,
  month: number, // 1-12
  banda: SeasonalityBand,
  targetYear?: number
): Promise<SeasonalityFactor | null> {
  // Tier 1: Same month previous year
  if (targetYear && targetYear > 1) {
    const { data: prevYear } = await admin
      .from('sumup_seasonality_3bands_12m')
      .select('peso_faixa, ano_historico')
      .eq('org_id', orgId)
      .eq('mes_historico', month)
      .eq('faixa', banda)
      .eq('ano_historico', targetYear - 1)
      .maybeSingle()

    if (prevYear && prevYear.peso_faixa !== null && prevYear.peso_faixa > 0) {
      return {
        faixa: banda,
        faixaMes: getBandLabel(banda),
        diaReferencia: getReferenceDay(banda),
        pesoFaixa: prevYear.peso_faixa,
        fonteSeasonalidade: 'ANO_ANTERIOR',
        anoHistoricoUtilizado: prevYear.ano_historico,
        receita_projetada_faixa: 0, // calculated later
      }
    }
  }

  // Tier 2: Most recent same month in history
  const { data: recentMonth } = await admin
    .from('sumup_seasonality_3bands_12m')
    .select('peso_faixa, ano_historico')
    .eq('org_id', orgId)
    .eq('mes_historico', month)
    .eq('faixa', banda)
    .order('ano_historico', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (recentMonth && recentMonth.peso_faixa !== null && recentMonth.peso_faixa > 0) {
    return {
      faixa: banda,
      faixaMes: getBandLabel(banda),
      diaReferencia: getReferenceDay(banda),
      pesoFaixa: recentMonth.peso_faixa,
      fonteSeasonalidade: 'MES_RECENTE',
      anoHistoricoUtilizado: recentMonth.ano_historico,
      receita_projetada_faixa: 0, // calculated later
    }
  }

  // Tier 3: Global 12-month average
  const { data: globalData } = await admin
    .from('sumup_seasonality_3bands_12m')
    .select('peso_faixa, ano_historico')
    .eq('org_id', orgId)
    .eq('faixa', banda)

  if (globalData && globalData.length > 0) {
    const avgPeso = globalData.reduce((sum, row) => sum + (row.peso_faixa || 0), 0) / globalData.length
    if (avgPeso > 0) {
      return {
        faixa: banda,
        faixaMes: getBandLabel(banda),
        diaReferencia: getReferenceDay(banda),
        pesoFaixa: avgPeso,
        fonteSeasonalidade: 'PERFIL_GLOBAL',
        anoHistoricoUtilizado: 0, // global average
        receita_projetada_faixa: 0, // calculated later
      }
    }
  }

  // Fallback: equal distribution
  return {
    faixa: banda,
    faixaMes: getBandLabel(banda),
    diaReferencia: getReferenceDay(banda),
    pesoFaixa: 1 / 3, // equal distribution
    fonteSeasonalidade: 'PERFIL_GLOBAL',
    anoHistoricoUtilizado: 0,
    receita_projetada_faixa: 0, // calculated later
  }
}

/**
 * Apply seasonality distribution to monthly forecast
 * Returns the three bands with peso and projected amounts
 *
 * Invariant checks:
 * - SUM(peso_faixa) ≈ 1.0
 * - SUM(receita_projetada_faixa) = receita_projetada_total
 */
export async function applySeasonalityToMonth(
  admin: AdminClient,
  orgId: string,
  month: number,
  year: number,
  receita_projetada: number
): Promise<SeasonalityProfile> {
  const bandas: SeasonalityFactor[] = []
  let somaPesos = 0
  let somaReceitas = 0

  for (const banda of [1, 2, 3] as SeasonalityBand[]) {
    const factor = await getSeasonalityWeight(admin, orgId, month, banda, year)
    if (!factor) continue

    factor.receita_projetada_faixa = Math.round(receita_projetada * factor.pesoFaixa * 100) / 100

    bandas.push(factor)
    somaPesos += factor.pesoFaixa
    somaReceitas += factor.receita_projetada_faixa
  }

  // Check invariants
  const somaPesosOk = Math.abs(somaPesos - 1.0) < 0.01 // allow 0.01 rounding difference
  const somaReceitasOk = Math.abs(somaReceitas - receita_projetada) < 0.01 // allow 0.01 rounding difference

  return {
    bandas,
    receita_projetada_total: receita_projetada,
    invariante_check: {
      soma_pesos: somaPesos,
      soma_receitas: somaReceitas,
      valida: somaPesosOk && somaReceitasOk,
    },
  }
}

/**
 * For a given forecast band, generate reference date
 * Used to tag which band this applies to in ledger/receipts
 */
export function getDateForBand(year: number, month: number, banda: SeasonalityBand): Date {
  const day = getReferenceDay(banda)
  return new Date(year, month - 1, day) // month is 0-indexed in Date
}
