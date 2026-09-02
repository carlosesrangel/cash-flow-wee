import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { MonthlyValue } from '@/lib/forecast/scenarios'
import { calculateEffectiveSimplesTaxRate, type SimplesAnexo, type Simples2027Regime } from '@/lib/tax/simples-nacional'

/**
 * Default tax rate fallback when configuration not found
 */
/** Zero means unavailable; the application must never invent a tax rate. */
export const DEFAULT_TAX_RATE = 0

export type TaxObligation = {
  ano: number
  mes: number
  receitaProjetada: number
  aliquota: number
  aliquotaNominal: number
  parcelaDeduzir: number
  rbt12: number
  faixa: string
  valorImposto: number
  vencimento: string
  origem: 'realizado' | 'projetado'
}

export type TaxConfiguration = {
  orgId: string
  simplesAnexo: SimplesAnexo
  regime2027: Simples2027Regime
  purchaseCreditPercentage: number
}

/**
 * Load tax configuration for an organization
 */
export async function loadTaxConfiguration(orgId: string): Promise<TaxConfiguration | null> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('tax_configurations')
    .select('*')
    .eq('org_id', orgId)
    .single()

  if (error || !data) return null

  return {
    orgId: data.org_id,
    simplesAnexo: data.simples_anexo as SimplesAnexo,
    regime2027: data.regime_2027 as Simples2027Regime,
    purchaseCreditPercentage: data.purchase_credit_percentage || 0.8,
  }
}

/**
 * Tax due date: always day 20 of the following month (Simples Nacional standard)
 * December rolls to January of next year.
 */
export function taxPaymentDate(ano: number, mes: number): string {
  const date = new Date(Date.UTC(ano, mes, 20))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-20`
}

/**
 * Compute tax schedule using dynamic tax configuration.
 * If RBT12 is unavailable, returns zero with an explicit incomplete-base label.
 *
 * Note: This uses a simplified approach for now.
 * Full implementation would need:
 * - RBT12 calculation from actual revenue history
 * - Monthly reconciliation of actual vs forecasted tax
 * - Adjustment periods for year-end true-up
 */
export function computeTaxSchedule(
  entries: MonthlyValue[],
  aliquota?: number,
  rbt12?: number,
  simplesAnexo?: SimplesAnexo,
  year?: number
): TaxObligation[] {
  // If explicit rate provided, use it (backwards compatibility)
  if (aliquota !== undefined) {
    return entries
      .map((entry) => ({
        ano: entry.ano,
        mes: entry.mes,
        receitaProjetada: entry.value,
        aliquota,
        aliquotaNominal: aliquota,
        parcelaDeduzir: 0,
        rbt12: rbt12 ?? 0,
        valorImposto: Math.round(entry.value * aliquota * 100) / 100,
        vencimento: taxPaymentDate(entry.ano, entry.mes),
        faixa: 'Alíquota informada',
        origem: 'projetado' as const,
      }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
  }

  // Dynamic calculation using RBT12 if provided
  return entries
    .map((entry) => {
      // Do not approximate a rate when the rolling revenue base is absent.
      const taxInfo = rbt12
        ? calculateEffectiveSimplesTaxRate(rbt12, entry.ano)
        : { aliquota_efetiva: 0, aliquota_nominal: 0, parcela_deduzir: 0, faixa: 'Sem RBT12 — configuração necessária' }
      return {
        ano: entry.ano,
        mes: entry.mes,
        receitaProjetada: entry.value,
        aliquota: taxInfo.aliquota_efetiva,
        aliquotaNominal: taxInfo.aliquota_nominal,
        parcelaDeduzir: taxInfo.parcela_deduzir,
        rbt12: rbt12 ?? 0,
        faixa: taxInfo.faixa,
        valorImposto: Math.round(entry.value * taxInfo.aliquota_efetiva * 100) / 100,
        vencimento: taxPaymentDate(entry.ano, entry.mes),
        origem: 'projetado' as const,
      }
    })
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
}
