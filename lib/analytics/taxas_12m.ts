/**
 * Taxas_12M: 12-Month Historical Fee Rates
 *
 * Aggregates fees from successful transactions grouped by:
 * - payment_type
 * - card_type
 * - nro_parcelas_modelo (installments)
 * - entry_mode
 * - payout_plan
 *
 * Source: sumup_transactions + sumup_payouts
 * Join: transaction_code
 *
 * Power Query specification: Points 1-6
 */

import { SupabaseClient } from '@supabase/supabase-js'

export interface FeeRateMetrics {
  org_id: string
  payment_type: string
  card_type: string
  nro_parcelas_modelo: number
  entry_mode: string
  payout_plan: string

  qtd_transacoes_12m: number
  valor_bruto_12m: number

  qtd_com_fee: number
  valor_base_taxa_12m: number
  fee_total_12m: number

  taxa_media_simples: number | null
  taxa_media_ponderada: number | null

  pct_valor_12m: number
  pct_transacoes_12m: number

  confiabilidade: 'ALTA' | 'MEDIA' | 'BAIXA'

  inicio_janela: string
  fim_janela: string
}

interface TransactionWithPayout {
  tx_id: string
  tx_amount_gross: number
  tx_fee_amount: number | null
  tx_status: string
  tx_payment_type: string | null
  tx_card_type: string | null
  tx_installments_count: number | null
  tx_entry_mode: string | null
  tx_payout_plan: string | null
  tx_payouts_total: number | null
  tx_payouts_received: number | null

  payout_ids: string[] // aggregated from payouts grouped by transaction_code
  payout_fee_real_total: number | null
  payout_amount_total: number | null
}

/**
 * Normalize string fields: TRIM + UPPER
 * Empty/null becomes NAO_INFORMADO
 */
function normalizeString(value: string | null | undefined): string {
  if (!value || value.trim() === '') return 'NAO_INFORMADO'
  return value.trim().toUpperCase()
}

/**
 * Calculate nro_parcelas_modelo per Power Query spec
 * Priority: installments_count > payouts_total > 1
 */
function getNroParcelasModelo(
  installments_count: number | null | undefined,
  payouts_total: number | null | undefined
): number {
  if (installments_count && installments_count > 0) return installments_count
  if (payouts_total && payouts_total > 0) return payouts_total
  return 1
}

/**
 * Determine if a transaction's fee should be counted
 *
 * Per Power Query spec (Point 4):
 * - If FeeRealTotal is null → FeeConsiderado = null
 * - Else if payouts_received < payouts_total → FeeConsiderado = null (partial payout)
 * - Else → FeeConsiderado = FeeRealTotal
 *
 * IMPORTANT: Transaction still counts toward Qtd/Valor totals even if FeeConsiderado is null
 */
function calculateFeeConsiderado(
  feeRealTotal: number | null,
  payoutsTotal: number | null,
  payoutsReceived: number | null
): number | null {
  if (feeRealTotal === null) return null

  if (
    payoutsTotal !== null &&
    payoutsReceived !== null &&
    payoutsReceived < payoutsTotal
  ) {
    return null // Partial payout: exclude from fee metrics
  }

  return feeRealTotal
}

/**
 * Calculate Taxas_12M for an organization
 * Window: DataHoje - 12 months to DataHoje
 */
export async function calculateTaxas12m(
  admin: SupabaseClient,
  orgId: string
): Promise<FeeRateMetrics[]> {
  const now = new Date()
  const windowStart = new Date(now)
  windowStart.setMonth(windowStart.getMonth() - 12)

  const startDate = windowStart.toISOString().split('T')[0]
  const endDate = now.toISOString().split('T')[0]

  // Load transactions
  const { data: transactions, error: txError } = await admin
    .from('sumup_transactions')
    .select(
      `
      id,
      transaction_code,
      amount,
      fee_amount,
      status,
      payment_type,
      card_type,
      installments_count,
      entry_mode,
      payout_plan,
      payouts_total,
      payouts_received
    `
    )
    .eq('org_id', orgId)
    .eq('type', 'PAYMENT')
    .eq('status', 'SUCCESSFUL')
    .gt('amount', 0)
    .gte('timestamp_utc', `${startDate}T00:00:00Z`)
    .lte('timestamp_utc', `${endDate}T23:59:59Z`)

  if (txError) throw new Error(`Failed to load transactions: ${txError.message}`)

  // Load payouts grouped by transaction_code
  const { data: payouts, error: payoutError } = await admin
    .from('sumup_payouts')
    .select(
      `
      transaction_code,
      fee,
      amount
    `
    )
    .eq('org_id', orgId)
    .eq('type', 'PAYOUT')
    .eq('status', 'SUCCESSFUL')
    .not('transaction_code', 'is', null)
    .gte('payout_date', startDate)
    .lte('payout_date', endDate)

  if (payoutError) throw new Error(`Failed to load payouts: ${payoutError.message}`)

  // Group payouts by transaction_code
  const payoutsByTxCode = new Map<string, { feeTotal: number; amountTotal: number; count: number }>()
  for (const payout of payouts || []) {
    const txCode = payout.transaction_code
    if (!txCode) continue

    const existing = payoutsByTxCode.get(txCode) || { feeTotal: 0, amountTotal: 0, count: 0 }
    existing.feeTotal += Math.abs(payout.fee || 0)
    existing.amountTotal += payout.amount || 0
    existing.count += 1
    payoutsByTxCode.set(txCode, existing)
  }

  // Build transaction records with aggregated payout data
  const txWithPayouts: TransactionWithPayout[] = []
  for (const tx of transactions || []) {
    const payoutData = payoutsByTxCode.get(tx.transaction_code)

    txWithPayouts.push({
      tx_id: tx.id,
      tx_amount_gross: tx.amount,
      tx_fee_amount: tx.fee_amount,
      tx_status: tx.status,
      tx_payment_type: tx.payment_type,
      tx_card_type: tx.card_type,
      tx_installments_count: tx.installments_count,
      tx_entry_mode: tx.entry_mode,
      tx_payout_plan: tx.payout_plan,
      tx_payouts_total: tx.payouts_total,
      tx_payouts_received: tx.payouts_received,

      payout_ids: [], // simplified; not tracking individual IDs for now
      payout_fee_real_total: payoutData?.feeTotal ?? null,
      payout_amount_total: payoutData?.amountTotal ?? null,
    })
  }

  // Aggregate by (payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan)
  const aggregates = new Map<string, {
    transactions: TransactionWithPayout[]
    qtd_com_fee: number
  }>()

  let totalQtd = 0
  let totalValorBruto = 0

  for (const tx of txWithPayouts) {
    totalQtd += 1
    totalValorBruto += tx.tx_amount_gross

    const paymentType = normalizeString(tx.tx_payment_type)
    const cardType = normalizeString(tx.tx_card_type)
    const nroParcelas = getNroParcelasModelo(tx.tx_installments_count, tx.tx_payouts_total)
    const entryMode = normalizeString(tx.tx_entry_mode)
    const payoutPlan = normalizeString(tx.tx_payout_plan)

    const key = `${paymentType}|${cardType}|${nroParcelas}|${entryMode}|${payoutPlan}`

    const existing = aggregates.get(key) || { transactions: [], qtd_com_fee: 0 }
    existing.transactions.push(tx)

    // Count if this transaction contributes to fee metrics
    const feeConsiderado = calculateFeeConsiderado(
      tx.payout_fee_real_total,
      tx.tx_payouts_total,
      tx.tx_payouts_received
    )
    if (feeConsiderado !== null) {
      existing.qtd_com_fee += 1
    }

    aggregates.set(key, existing)
  }

  // Calculate final metrics
  const results: FeeRateMetrics[] = []

  for (const [key, group] of aggregates.entries()) {
    const [paymentType, cardType, nroParcelasStr, entryMode, payoutPlan] = key.split('|')
    const nroParcelas = parseInt(nroParcelasStr, 10)

    // Aggregate metrics
    let qtdTransacoes = 0
    let valorBruto = 0
    let qtdComFee = 0
    let valorBaseTaxa = 0
    let feeTotal = 0
    const feeRatios: number[] = []

    for (const tx of group.transactions) {
      qtdTransacoes += 1
      valorBruto += tx.tx_amount_gross

      const feeConsiderado = calculateFeeConsiderado(
        tx.payout_fee_real_total,
        tx.tx_payouts_total,
        tx.tx_payouts_received
      )

      if (feeConsiderado !== null) {
        qtdComFee += 1
        valorBaseTaxa += tx.tx_amount_gross
        feeTotal += feeConsiderado
        feeRatios.push(feeConsiderado / tx.tx_amount_gross)
      }
    }

    // Taxa média simples: AVERAGE(fee/amount) for rows where fee is not null
    const taxaMediaSimples = feeRatios.length > 0 ? feeRatios.reduce((a, b) => a + b) / feeRatios.length : null

    // Taxa média ponderada: Fee Total / Valor Base Taxa
    const taxaMediaPonderada = valorBaseTaxa > 0 ? feeTotal / valorBaseTaxa : null

    // Percentages
    const pctValor = totalValorBruto > 0 ? valorBruto / totalValorBruto : 0
    const pctTransacoes = totalQtd > 0 ? qtdTransacoes / totalQtd : 0

    // Confiabilidade
    const confiabilidade: 'ALTA' | 'MEDIA' | 'BAIXA' =
      qtdComFee >= 30 ? 'ALTA' : qtdComFee >= 10 ? 'MEDIA' : 'BAIXA'

    results.push({
      org_id: orgId,
      payment_type: paymentType,
      card_type: cardType,
      nro_parcelas_modelo: nroParcelas,
      entry_mode: entryMode,
      payout_plan: payoutPlan,

      qtd_transacoes_12m: qtdTransacoes,
      valor_bruto_12m: valorBruto,

      qtd_com_fee: qtdComFee,
      valor_base_taxa_12m: valorBaseTaxa,
      fee_total_12m: feeTotal,

      taxa_media_simples: taxaMediaSimples,
      taxa_media_ponderada: taxaMediaPonderada,

      pct_valor_12m: pctValor,
      pct_transacoes_12m: pctTransacoes,

      confiabilidade,

      inicio_janela: startDate,
      fim_janela: endDate,
    })
  }

  return results
}
