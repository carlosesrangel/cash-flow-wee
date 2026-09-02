export type TinyCardSale = { id: string; externalId?: string | null; reference?: string | null; orderId?: string | null; amount: number; date: string; installments?: number | null; paymentMethod?: string | null; status?: string | null }
export type SumupTransaction = { id: string; externalId?: string | null; reference?: string | null; orderId?: string | null; amount: number; date: string; installments?: number | null }
export type ReconciliationClassification = 'MATCHED' | 'UNMATCHED_TINY' | 'UNMATCHED_SUMUP' | 'AMBIGUOUS' | 'NOT_APPLICABLE_PIX' | 'NOT_APPLICABLE_CASH' | 'CANCELLED' | 'REFUNDED'

export type ReconciliationResult = { tinyId?: string; sumupId?: string; status: ReconciliationClassification; reason: string; valueTiny?: number; valueSumup?: number }

function normalized(value: string | null | undefined) { return value?.trim().toLowerCase() || null }

export function reconcileTinyCards(tiny: TinyCardSale[], sumup: SumupTransaction[]): ReconciliationResult[] {
  const used = new Set<string>()
  const results: ReconciliationResult[] = []
  for (const sale of tiny) {
    const paymentMethod = normalized(sale.paymentMethod)
    const saleStatus = normalized(sale.status)
    if (saleStatus === 'cancelled' || saleStatus === 'canceled' || saleStatus === 'cancelado' || saleStatus === 'cancelada') {
      results.push({ tinyId: sale.id, status: 'CANCELLED', reason: 'Venda cancelada', valueTiny: sale.amount })
      continue
    }
    if (saleStatus === 'refunded' || saleStatus === 'refund' || saleStatus === 'estornado' || saleStatus === 'estornada') {
      results.push({ tinyId: sale.id, status: 'REFUNDED', reason: 'Venda estornada', valueTiny: sale.amount })
      continue
    }
    if (paymentMethod?.includes('pix')) {
      results.push({ tinyId: sale.id, status: 'NOT_APPLICABLE_PIX', reason: 'PIX é recebido fora do SumUp', valueTiny: sale.amount })
      continue
    }
    if (paymentMethod?.includes('dinheiro') || paymentMethod?.includes('cash') || paymentMethod?.includes('especie') || paymentMethod?.includes('espécie')) {
      results.push({ tinyId: sale.id, status: 'NOT_APPLICABLE_CASH', reason: 'Dinheiro é recebido fora do SumUp', valueTiny: sale.amount })
      continue
    }
    const candidates = sumup.filter((tx) => {
      if (used.has(tx.id)) return false
      const shared = [sale.externalId, sale.reference, sale.orderId].filter(Boolean).map(normalized)
      const txKeys = [tx.externalId, tx.reference, tx.orderId].filter(Boolean).map(normalized)
      return shared.some((key) => key && txKeys.includes(key))
    })
    if (candidates.length === 1) {
      used.add(candidates[0].id)
      results.push({ tinyId: sale.id, sumupId: candidates[0].id, status: 'MATCHED', reason: 'Identificador compartilhado', valueTiny: sale.amount, valueSumup: candidates[0].amount })
      continue
    }
    if (candidates.length > 1) {
      results.push({ tinyId: sale.id, status: 'AMBIGUOUS', reason: 'Mais de um candidato determinístico', valueTiny: sale.amount })
      continue
    }
    const controlled = sumup.filter((tx) => !used.has(tx.id) && Math.abs(tx.amount - sale.amount) < 0.01 && tx.date === sale.date && (tx.installments ?? null) === (sale.installments ?? null))
    if (controlled.length === 1) {
      used.add(controlled[0].id)
      results.push({ tinyId: sale.id, sumupId: controlled[0].id, status: 'MATCHED', reason: 'Valor, data e parcelas coincidentes', valueTiny: sale.amount, valueSumup: controlled[0].amount })
    } else if (controlled.length > 1) {
      results.push({ tinyId: sale.id, status: 'AMBIGUOUS', reason: 'Combinação valor/data/parcelas não é única', valueTiny: sale.amount })
    } else {
      results.push({ tinyId: sale.id, status: 'UNMATCHED_TINY', reason: 'Nenhum candidato determinístico', valueTiny: sale.amount })
    }
  }
  for (const tx of sumup) if (!used.has(tx.id)) results.push({ sumupId: tx.id, status: 'UNMATCHED_SUMUP', reason: 'Transação sem venda Tiny correspondente', valueSumup: tx.amount })
  return results
}

export function reconciliationMetrics(results: ReconciliationResult[]) {
  const count = (status: ReconciliationClassification) => results.filter((r) => r.status === status).length
  const reconciled = results.filter((r) => r.status === 'MATCHED')
  const tinyValue = results.filter((r) => r.tinyId).reduce((sum, r) => sum + (r.valueTiny ?? 0), 0)
  const sumupValue = results.filter((r) => r.sumupId).reduce((sum, r) => sum + (r.valueSumup ?? 0), 0)
  return { tinyCardSales: results.filter((r) => r.tinyId).length, sumupTransactions: results.filter((r) => r.sumupId).length, matched: reconciled.length, unmatchedTiny: count('UNMATCHED_TINY'), unmatchedSumup: count('UNMATCHED_SUMUP'), ambiguous: count('AMBIGUOUS'), matchRate: tinyValue > 0 ? reconciled.reduce((sum, r) => sum + (r.valueTiny ?? 0), 0) / tinyValue : 0, valueReconciled: reconciled.reduce((sum, r) => sum + Math.min(r.valueTiny ?? 0, r.valueSumup ?? 0), 0), valueVariance: Math.round((tinyValue - sumupValue) * 100) / 100 }
}
