const AMOUNT_TOLERANCE = 0.05
const DATE_WINDOW_DAYS = 5
export const CARD_PAYMENT_METHODS: readonly string[] = ['Cartão de crédito', 'Cartão de débito']

export function isCardPaymentMethod(formaRecebimentoNome: string | null): boolean {
  return formaRecebimentoNome !== null && CARD_PAYMENT_METHODS.includes(formaRecebimentoNome)
}

/**
 * `numeroDocumento` comes back from Olist as "<documento>/<parcela>", e.g.
 * "000516/03" for installment 3 of NF 516 (see
 * docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md, finding
 * 2). Returns null when the format doesn't match — non-installment
 * documents then fall through to `nao_reconciliado` instead of guessing.
 */
export function parseInstallmentNumber(numeroDocumento: string | null): number | null {
  if (!numeroDocumento) return null
  const match = /\/(\d+)$/.exec(numeroDocumento.trim())
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * SumUp's per-installment event amount is already net of SumUp's fee (spec
 * finding 3), so it can't be compared directly to the Olist gross
 * installment value. The transaction's total gross amount divided by its
 * installment count is the best available gross-per-installment estimate.
 */
export function computeGrossEstimate(transactionAmount: number, installmentsCount: number): number | null {
  if (!installmentsCount || installmentsCount <= 0) return null
  return Math.round((transactionAmount / installmentsCount) * 100) / 100
}

export function withinAmountTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE + 1e-10
}

export function withinDateWindow(dateA: string, dateB: string): boolean {
  const diffMs = Math.abs(new Date(dateA).getTime() - new Date(dateB).getTime())
  return diffMs <= DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000
}

export type MatchCandidate = {
  sumupTransactionEventId: string
  sumupTransactionId: string
  dueDate: string
  grossEstimate: number
}

export type MatchResult =
  | { status: 'nao_reconciliado'; matchReason: Record<string, unknown> }
  | {
      status: 'reconciliado_automaticamente'
      sumupTransactionEventId: string
      sumupTransactionId: string
      matchReason: Record<string, unknown>
    }
  | { status: 'conflito'; candidateIds: string[]; matchReason: Record<string, unknown> }

export function classifyCandidates(arValor: number, candidates: MatchCandidate[]): MatchResult {
  if (candidates.length === 0) {
    return {
      status: 'nao_reconciliado',
      matchReason: { motivo: 'nenhum_candidato_encontrado', candidatosAvaliados: 0 },
    }
  }

  if (candidates.length === 1) {
    const candidate = candidates[0]
    return {
      status: 'reconciliado_automaticamente',
      sumupTransactionEventId: candidate.sumupTransactionEventId,
      sumupTransactionId: candidate.sumupTransactionId,
      matchReason: {
        valorBrutoOlist: arValor,
        valorBrutoSumupEstimado: candidate.grossEstimate,
        diferencaValor: Math.round((arValor - candidate.grossEstimate) * 100) / 100,
      },
    }
  }

  return {
    status: 'conflito',
    candidateIds: candidates.map((candidate) => candidate.sumupTransactionEventId),
    matchReason: {
      motivo: 'multiplos_candidatos',
      candidatosAvaliados: candidates.length,
      candidatos: candidates.map((candidate) => ({
        sumupTransactionEventId: candidate.sumupTransactionEventId,
        valorBrutoSumupEstimado: candidate.grossEstimate,
        dataVencimentoSumup: candidate.dueDate,
      })),
    },
  }
}
