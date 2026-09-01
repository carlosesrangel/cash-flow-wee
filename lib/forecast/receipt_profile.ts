/**
 * Receipt Profile Engine: Payment Timing Distribution
 *
 * For each modality (payment_type + card_type + nro_parcelas + entry_mode + payout_plan),
 * calculates the months-to-receipt distribution (M+0, M+1, M+2, etc).
 *
 * Uses DATE_TRUNC arithmetic: (YEAR * 12 + MONTH) to calculate month difference.
 *
 * Power Query specification: Points 8-10
 */

import { SupabaseClient } from '@supabase/supabase-js'

export interface ReceiptProfileEntry {
  payment_type: string
  card_type: string
  nro_parcelas: number
  entry_mode: string
  payout_plan: string
  meses_ate_receber: number
  valor_recebido: number
  qtd_recebimentos: number
  pct_recebimento_modalidade: number
}

export interface ReceiptProfileResult {
  payment_type: string
  card_type: string
  nro_parcelas: number
  entry_mode: string
  payout_plan: string
  distributions: ReceiptProfileEntry[]
  confiabilidade: 'ALTA' | 'MEDIA' | 'BAIXA'
  total_payouts_analyzed: number
}

/**
 * Calculate months-to-receipt for a specific modality
 */
export async function calculateReceiptProfile(
  admin: SupabaseClient,
  orgId: string,
  payment_type: string,
  card_type: string,
  nro_parcelas: number,
  entry_mode: string,
  payout_plan: string
): Promise<ReceiptProfileResult> {
  // Load transactions: type=PAYMENT, status=SUCCESSFUL, amount > 0, transaction_code not null
  const { data: transactions, error: txError } = await admin
    .from('sumup_transactions')
    .select(
      'id, transaction_code, timestamp_utc, created_at, payment_type, card_type, installments_count, entry_mode, payout_plan, amount'
    )
    .eq('org_id', orgId)
    .eq('type', 'PAYMENT')
    .eq('status', 'SUCCESSFUL')
    .eq('payment_type', payment_type)
    .eq('card_type', card_type)
    .eq('entry_mode', entry_mode)
    .eq('payout_plan', payout_plan)
    .eq('installments_count', nro_parcelas)
    .gt('amount', 0)
    .not('transaction_code', 'is', null)

  if (txError) throw new Error(`Failed to load transactions: ${txError.message}`)

  // Build map: transaction_code -> (date, nro_parcelas_modelo)
  const txMap = new Map<
    string,
    {
      saleDate: Date
      nroParcelas: number
    }
  >()

  for (const tx of transactions || []) {
    let nroParcelas = tx.installments_count || 1
    if (!nroParcelas || nroParcelas <= 0) {
      nroParcelas = 1
    }

    txMap.set(tx.transaction_code, {
      saleDate: new Date(tx.timestamp_utc || tx.created_at),
      nroParcelas,
    })
  }

  // Load payouts: status=SUCCESSFUL or NULL, type=PAYOUT or NULL, amount not null, date not null
  const { data: payouts, error: payoutError } = await admin
    .from('sumup_payouts')
    .select('transaction_code, amount, date, status, type')
    .eq('org_id', orgId)
    .not('transaction_code', 'is', null)
    .not('date', 'is', null)
    .not('amount', 'is', null)

  if (payoutError) throw new Error(`Failed to load payouts: ${payoutError.message}`)

  // Filter payouts: (status = SUCCESSFUL OR NULL) AND (type = PAYOUT OR NULL)
  const validPayouts = (payouts || []).filter(
    (p) => (!p.status || p.status === 'SUCCESSFUL') && (!p.type || p.type === 'PAYOUT')
  )

  // Group by months-to-receipt
  const receiptsMap = new Map<
    number,
    {
      valor: number
      count: number
    }
  >()

  let totalPayoutsCount = 0

  for (const payout of validPayouts) {
    const txData = txMap.get(payout.transaction_code)
    if (!txData) continue

    totalPayoutsCount += 1

    // Calculate month difference using (YEAR * 12 + MONTH) arithmetic
    const saleDate = txData.saleDate
    const payoutDate = new Date(payout.date)

    const saleYear = saleDate.getFullYear()
    const saleMonth = saleDate.getMonth() + 1
    const payoutYear = payoutDate.getFullYear()
    const payoutMonth = payoutDate.getMonth() + 1

    const mesesAteReceber = payoutYear * 12 + payoutMonth - (saleYear * 12 + saleMonth)
    const clampedMeses = Math.max(0, mesesAteReceber)

    const existing = receiptsMap.get(clampedMeses) || { valor: 0, count: 0 }
    existing.valor += payout.amount || 0
    existing.count += 1
    receiptsMap.set(clampedMeses, existing)
  }

  // Calculate percentages
  const totalValor = Array.from(receiptsMap.values()).reduce((sum, r) => sum + r.valor, 0)

  const distributions: ReceiptProfileEntry[] = []

  for (const [meses, data] of receiptsMap.entries()) {
    distributions.push({
      payment_type,
      card_type,
      nro_parcelas,
      entry_mode,
      payout_plan,
      meses_ate_receber: meses,
      valor_recebido: data.valor,
      qtd_recebimentos: data.count,
      pct_recebimento_modalidade: totalValor > 0 ? data.valor / totalValor : 0,
    })
  }

  // Sort by meses_ate_receber
  distributions.sort((a, b) => a.meses_ate_receber - b.meses_ate_receber)

  // Calculate confiabilidade based on total payouts analyzed
  const confiabilidade: 'ALTA' | 'MEDIA' | 'BAIXA' =
    totalPayoutsCount >= 30 ? 'ALTA' : totalPayoutsCount >= 10 ? 'MEDIA' : 'BAIXA'

  return {
    payment_type,
    card_type,
    nro_parcelas,
    entry_mode,
    payout_plan,
    distributions,
    confiabilidade,
    total_payouts_analyzed: totalPayoutsCount,
  }
}

/**
 * Validate receipt profile invariants
 * SUM(pct_recebimento_modalidade) should = 1.0 per modality
 */
export function validateReceiptProfileInvariants(result: ReceiptProfileResult): boolean {
  const sum = result.distributions.reduce((total, d) => total + d.pct_recebimento_modalidade, 0)
  return Math.abs(sum - 1.0) < 0.0001
}

/**
 * Project payment receipt for a transaction
 * Given sale amount, sale date, and receipt profile, return distribution across months
 *
 * @param saleAmount sale revenue (before fees)
 * @param saleYearMonth sale date in 'YYYY-MM' format
 * @param receiptProfile receipt timing distribution for the modality
 */
export function projectPaymentReceipt(
  saleAmount: number,
  saleYearMonth: string,
  receiptProfile: ReceiptProfileResult
): Array<{
  year: number
  month: number
  day: number // band day (1, 10, 20)
  expected_amount: number
  pct: number
}> {
  const [saleYear, saleMonth] = saleYearMonth.split('-').map(Number)

  return receiptProfile.distributions.map((dist) => {
    const receiptMonth = saleMonth + dist.meses_ate_receber
    let receiptYear = saleYear
    let finalMonth = receiptMonth

    // Handle month overflow
    if (finalMonth > 12) {
      receiptYear += Math.floor((finalMonth - 1) / 12)
      finalMonth = ((finalMonth - 1) % 12) + 1
    }

    // Determine band day based on band order
    const bandIndex = receiptProfile.distributions.indexOf(dist)
    let bandDay = 1
    if (bandIndex === 1) bandDay = 10
    else if (bandIndex === 2) bandDay = 20
    // For any others, cycle
    else if (bandIndex > 2) bandDay = 1 + ((bandIndex % 3) * 10)

    return {
      year: receiptYear,
      month: finalMonth,
      day: Math.min(bandDay, 28), // clamp to valid day
      expected_amount: Math.round(saleAmount * dist.pct_recebimento_modalidade * 100) / 100, // 2 decimals
      pct: dist.pct_recebimento_modalidade,
    }
  })
}
