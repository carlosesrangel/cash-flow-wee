/**
 * Receipt Profile Engine: Payment Timing Distribution
 *
 * For each modality (payment_type + card_type + nro_parcelas + entry_mode + payout_plan),
 * calculates the months-to-receipt distribution (M+0, M+1, M+2, etc).
 *
 * Uses DATE_TRUNC arithmetic: (YEAR * 12 + MONTH) to calculate month difference.
 * NOT dias/30 (wrong approach).
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
  pct_recebimento_modalidade: number // SUM = 1.0 per modality
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
  // Load transactions
  const { data: transactions, error: txError } = await admin
    .from('sumup_transactions')
    .select('id, transaction_code, created_at, payment_type, card_type, installments_count, entry_mode, payout_plan')
    .eq('org_id', orgId)
    .eq('type', 'PAYMENT')
    .eq('status', 'SUCCESSFUL')
    .eq('payment_type', payment_type)
    .eq('card_type', card_type)
    .eq('entry_mode', entry_mode)
    .eq('payout_plan', payout_plan)
    .gte('installments_count', nro_parcelas)
    .lte('installments_count', nro_parcelas)

  if (txError) throw new Error(`Failed to load transactions: ${txError.message}`)

  // Build map of transaction_code -> created_at for quick lookup
  const txCreatedAtMap = new Map<string, Date>()
  for (const tx of transactions || []) {
    txCreatedAtMap.set(tx.transaction_code, new Date(tx.created_at))
  }

  // Load payouts
  const { data: payouts, error: payoutError } = await admin
    .from('sumup_payouts')
    .select('transaction_code, amount, date, status')
    .eq('org_id', orgId)
    .eq('type', 'PAYOUT')
    .in('status', ['SUCCESSFUL'])
    .not('transaction_code', 'is', null)
    .not('date', 'is', null)

  if (payoutError) throw new Error(`Failed to load payouts: ${payoutError.message}`)

  // Group by months-to-receipt
  const receiptsMap = new Map<
    number,
    {
      valor: number
      count: number
    }
  >()

  let totalPayoutsCount = 0

  for (const payout of payouts || []) {
    const txCreatedAt = txCreatedAtMap.get(payout.transaction_code)
    if (!txCreatedAt) continue

    totalPayoutsCount += 1

    // Calculate month difference using DATE_TRUNC arithmetic
    const txDate = new Date(txCreatedAt)
    const payoutDate = new Date(payout.date)

    const txYear = txDate.getFullYear()
    const txMonth = txDate.getMonth() + 1
    const payoutYear = payoutDate.getFullYear()
    const payoutMonth = payoutDate.getMonth() + 1

    const mesesAteReceber = payoutYear * 12 + payoutMonth - (txYear * 12 + txMonth)
    const clampedMeses = Math.max(0, mesesAteReceber) // Shouldn't be negative, but clamp just in case

    const existing = receiptsMap.get(clampedMeses) || { valor: 0, count: 0 }
    existing.valor += Math.abs(payout.amount || 0)
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
  return Math.abs(sum - 1.0) < 0.0001 // allow floating point error
}

/**
 * Project payment receipt for a transaction
 * Given sale month and modality, return expected receipt distribution
 */
export function projectPaymentReceipt(
  saleAmount: number,
  saleYearMonth: string, // 'YYYY-MM'
  receiptProfile: ReceiptProfileResult
): Array<{
  year: number
  month: number
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

    return {
      year: receiptYear,
      month: finalMonth,
      expected_amount: saleAmount * dist.pct_recebimento_modalidade,
      pct: dist.pct_recebimento_modalidade,
    }
  })
}
