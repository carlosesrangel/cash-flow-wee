/**
 * Financial Model V2: Receipt Profile (Perfil_Recebimento_12M)
 *
 * Implements parity with legacy Excel Power Query: Perfil_Recebimento_12M
 *
 * Historical distribution of how long payments take to arrive
 * after a sale (measured in months)
 *
 * Dimensions: payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan
 * Output: percentage of amount received at each month offset
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>
type ReceiptProfileRow = any

export type ReceiptDistribution = {
  payment_type: string
  card_type: string
  nro_parcelas_modelo: number
  entry_mode: string
  payout_plan: string
  timing: {
    meses_ate_receber: number
    pct_recebimento: number
  }[]
  soma_pct: number // should be ~1.0
  valida: boolean
}

/**
 * Load receipt profile for a specific payment modality
 * Returns distribution by months_until_receipt
 */
export async function getReceiptProfile(
  admin: AdminClient,
  orgId: string,
  paymentType: string,
  cardType: string,
  nroParcelasModelo: number,
  entryMode: string,
  payoutPlan: string
): Promise<ReceiptProfileRow[] | null> {
  const { data, error } = await admin
    .from('sumup_receipt_profile_12m')
    .select('*')
    .eq('org_id', orgId)
    .eq('payment_type', paymentType)
    .eq('card_type', cardType)
    .eq('nro_parcelas_modelo', nroParcelasModelo)
    .eq('entry_mode', entryMode)
    .eq('payout_plan', payoutPlan)
    .order('meses_ate_receber', { ascending: true })

  if (error) {
    console.error('Failed to load receipt profile:', error)
    return null
  }

  return data
}

/**
 * Transform a projected sale amount using receipt profile timing
 *
 * For each timing in the profile:
 *   Date Recebimento = Data Venda + Meses Ate Receber
 *   Recebimento Bruto = Amount * % Recebimento
 *   Recebimento Liquido = Recebimento Bruto - Fee
 *
 * If no profile found: fallback to same month (0 months = 100%)
 */
export interface ProjectedReceipt {
  meses_ate_receber: number
  data_venda: Date
  data_recebimento: Date
  recebimento_bruto: number
  fee_aplicado: number
  recebimento_liquido: number
  pct_recebimento: number
  foi_fallback: boolean
}

export async function applyReceiptProfile(
  admin: AdminClient,
  orgId: string,
  data_venda: Date,
  valor_bruto: number,
  fee_aplicado: number,
  paymentType: string,
  cardType: string,
  nroParcelasModelo: number,
  entryMode: string,
  payoutPlan: string
): Promise<ProjectedReceipt[]> {
  const profile = await getReceiptProfile(
    admin,
    orgId,
    paymentType,
    cardType,
    nroParcelasModelo,
    entryMode,
    payoutPlan
  )

  if (profile && profile.length > 0) {
    // Use historical profile
    return profile.map((row) => {
      const data_recebimento = new Date(data_venda)
      data_recebimento.setMonth(data_recebimento.getMonth() + row.meses_ate_receber)

      const recebimento_bruto = Math.round(valor_bruto * row.pct_recebimento_modalidade * 100) / 100
      const fee_neste_recebimento = Math.round(fee_aplicado * row.pct_recebimento_modalidade * 100) / 100
      const recebimento_liquido = recebimento_bruto - fee_neste_recebimento

      return {
        meses_ate_receber: row.meses_ate_receber,
        data_venda,
        data_recebimento,
        recebimento_bruto,
        fee_aplicado: fee_neste_recebimento,
        recebimento_liquido,
        pct_recebimento: row.pct_recebimento_modalidade,
        foi_fallback: false,
      }
    })
  }

  // Fallback: same month, 100% of amount
  return [
    {
      meses_ate_receber: 0,
      data_venda,
      data_recebimento: data_venda,
      recebimento_bruto: valor_bruto,
      fee_aplicado,
      recebimento_liquido: valor_bruto - fee_aplicado,
      pct_recebimento: 1.0,
      foi_fallback: true,
    },
  ]
}

/**
 * Validate receipt profile invariant
 * For each modality: SUM(pct_recebimento) ≈ 1.0
 */
export function validateReceiptProfileInvariant(profile: ReceiptProfileRow[]): boolean {
  if (!profile || profile.length === 0) return true // empty is ok

  const somaPct = profile.reduce((sum, row) => sum + row.pct_recebimento_modalidade, 0)
  return Math.abs(somaPct - 1.0) < 0.01 // allow 0.01 rounding difference
}
