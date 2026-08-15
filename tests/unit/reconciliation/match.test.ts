import { describe, it, expect } from 'vitest'
import {
  isCardPaymentMethod,
  parseInstallmentNumber,
  computeGrossEstimate,
  withinAmountTolerance,
  withinDateWindow,
  classifyCandidates,
  CARD_PAYMENT_METHODS,
  type MatchCandidate,
} from '@/lib/reconciliation/match'

describe('isCardPaymentMethod', () => {
  it('accepts credit and debit card, rejects everything else including null', () => {
    expect(isCardPaymentMethod('Cartão de crédito')).toBe(true)
    expect(isCardPaymentMethod('Cartão de débito')).toBe(true)
    expect(isCardPaymentMethod('Pix')).toBe(false)
    expect(isCardPaymentMethod('Boleto')).toBe(false)
    expect(isCardPaymentMethod(null)).toBe(false)
  })
})

describe('parseInstallmentNumber', () => {
  it('parses the trailing /NN of a real numeroDocumento', () => {
    expect(parseInstallmentNumber('000516/03')).toBe(3)
  })

  it('returns null for a document with no installment suffix', () => {
    expect(parseInstallmentNumber('D1')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parseInstallmentNumber(null)).toBeNull()
  })

  it('returns null for a zero installment number', () => {
    expect(parseInstallmentNumber('000516/00')).toBeNull()
  })
})

describe('computeGrossEstimate', () => {
  it('divides transaction amount by installments and rounds to the cent', () => {
    // 8092 / 10 = 809.2
    expect(computeGrossEstimate(8092, 10)).toBe(809.2)
  })

  it('returns null when installmentsCount is zero or missing', () => {
    expect(computeGrossEstimate(100, 0)).toBeNull()
  })
})

describe('withinAmountTolerance', () => {
  it('accepts a difference of exactly R$ 0.05', () => {
    expect(withinAmountTolerance(380, 379.95)).toBe(true)
  })

  it('rejects a difference greater than R$ 0.05', () => {
    expect(withinAmountTolerance(380, 379.9)).toBe(false)
  })
})

describe('withinDateWindow', () => {
  it('accepts exactly 5 days apart', () => {
    expect(withinDateWindow('2026-02-01', '2026-02-06')).toBe(true)
  })

  it('rejects 6 days apart', () => {
    expect(withinDateWindow('2026-02-01', '2026-02-07')).toBe(false)
  })
})

describe('classifyCandidates', () => {
  const candidate = (overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
    sumupTransactionEventId: 'event-1',
    sumupTransactionId: 'tx-1',
    dueDate: '2026-02-02',
    grossEstimate: 380,
    ...overrides,
  })

  it('returns nao_reconciliado with zero candidates', () => {
    const result = classifyCandidates(380, [])
    expect(result.status).toBe('nao_reconciliado')
  })

  it('returns reconciliado_automaticamente with exactly one candidate', () => {
    const result = classifyCandidates(380, [candidate()])
    expect(result).toMatchObject({
      status: 'reconciliado_automaticamente',
      sumupTransactionEventId: 'event-1',
      sumupTransactionId: 'tx-1',
    })
  })

  it('returns conflito with more than one candidate, listing every candidate id', () => {
    const result = classifyCandidates(380, [
      candidate({ sumupTransactionEventId: 'event-1' }),
      candidate({ sumupTransactionEventId: 'event-2' }),
    ])
    expect(result.status).toBe('conflito')
    expect(result.status === 'conflito' && result.candidateIds).toEqual(['event-1', 'event-2'])
  })

  it('includes each candidate\'s amount and due date in matchReason for a conflito result', () => {
    const result = classifyCandidates(380, [
      candidate({ sumupTransactionEventId: 'event-1', grossEstimate: 379.98, dueDate: '2026-02-02' }),
      candidate({ sumupTransactionEventId: 'event-2', grossEstimate: 380.02, dueDate: '2026-02-03' }),
    ])
    expect(result.status).toBe('conflito')
    expect(result.status === 'conflito' && result.matchReason.candidatos).toEqual([
      { sumupTransactionEventId: 'event-1', valorBrutoSumupEstimado: 379.98, dataVencimentoSumup: '2026-02-02' },
      { sumupTransactionEventId: 'event-2', valorBrutoSumupEstimado: 380.02, dataVencimentoSumup: '2026-02-03' },
    ])
  })
})

describe('CARD_PAYMENT_METHODS', () => {
  it('is the exact list isCardPaymentMethod checks against', () => {
    expect(CARD_PAYMENT_METHODS).toEqual(['Cartão de crédito', 'Cartão de débito'])
  })
})
