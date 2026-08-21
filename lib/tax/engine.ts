import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { MonthlyValue } from '@/lib/forecast/scenarios'
import { getSimplesTaxRate, type SimplesAnexo, type Simples2027Regime } from '@/lib/tax/simples-nacional'

/**
 * Default tax rate fallback when configuration not found
 */
export const DEFAULT_TAX_RATE = 0.06

export type TaxObligation = {
  ano: number
  mes: number
  receitaProjetada: number
  aliquota: number
  valorImposto: number
  vencimento: string
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
function dueDateForMonth(ano: number, mes: number): string {
  const dueMonth = mes === 12 ? 1 : mes + 1
  const dueYear = mes === 12 ? ano + 1 : ano
  return `${dueYear}-${String(dueMonth).padStart(2, '0')}-20`
}

/**
 * Compute tax schedule using dynamic tax configuration.
 * Falls back to DEFAULT_TAX_RATE (6%) if configuration not found.
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
        valorImposto: Math.round(entry.value * aliquota * 100) / 100,
        vencimento: dueDateForMonth(entry.ano, entry.mes),
      }))
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
  }

  // Dynamic calculation using RBT12 if provided
  const currentYear = year || new Date().getFullYear()
  const annexo = simplesAnexo || 'anexo-iii'

  return entries
    .map((entry) => {
      // Use dynamic rate if RBT12 provided, otherwise fall back
      const rate = rbt12 ? getSimplesTaxRate(rbt12, annexo, entry.ano) : DEFAULT_TAX_RATE
      return {
        ano: entry.ano,
        mes: entry.mes,
        receitaProjetada: entry.value,
        aliquota: rate,
        valorImposto: Math.round(entry.value * rate * 100) / 100,
        vencimento: dueDateForMonth(entry.ano, entry.mes),
      }
    })
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
}
