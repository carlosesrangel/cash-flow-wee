import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyPayableStatus } from '@/lib/payables/classify-status'

const TODAY = '2026-09-01'

function classify({
  situacao = 'aberto',
  saldo = 100,
  valor = 100,
  dueDate = TODAY,
}: {
  situacao?: string | null
  saldo?: number | null
  valor?: number | null
  dueDate?: string | null
}) {
  return classifyPayableStatus(situacao, saldo, valor, dueDate, null, 'America/Sao_Paulo')
}

describe('classifyPayableStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T12:00:00-03:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('uses the factual pago situation regardless of due date', () => {
    expect(classify({ situacao: 'pago', dueDate: '2026-08-01' }).status).toBe('paid')
    expect(classify({ situacao: 'pago', dueDate: '2026-10-01' }).status).toBe('paid')
  })

  it('recognizes a known zero balance as paid only with a positive value', () => {
    expect(classify({ saldo: 0, valor: 100 }).status).toBe('paid')
    expect(classify({ saldo: 0, valor: null }).status).not.toBe('paid')
  })

  it('does not treat a missing balance as paid', () => {
    expect(classify({ saldo: null, valor: 100, dueDate: '2026-08-31' }).status).toBe('overdue')
  })

  it('gives cancellation precedence', () => {
    expect(classify({ situacao: 'cancelada', saldo: 0 }).status).toBe('cancelled')
    expect(classify({ situacao: 'cancelado', saldo: 0 }).status).toBe('cancelled')
  })

  it('classifies partial and open obligations by date', () => {
    expect(classify({ situacao: 'parcial', saldo: 20, valor: 100, dueDate: '2026-08-31' }).status).toBe('overdue')
    expect(classify({ situacao: 'parcial', saldo: 20, valor: 100, dueDate: TODAY }).status).toBe('due_soon')
    expect(classify({ dueDate: '2026-08-31' }).status).toBe('overdue')
    expect(classify({ dueDate: TODAY }).status).toBe('due_soon')
    expect(classify({ dueDate: '2026-09-08' }).status).toBe('due_soon')
    expect(classify({ dueDate: '2026-09-09' }).status).toBe('open')
  })

  it('keeps missing due dates open', () => {
    expect(classify({ dueDate: null }).status).toBe('open')
  })

  it('uses deterministic date-only boundaries in the business timezone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T01:30:00.000Z')) // Sep 1 in Sao Paulo
    expect(classify({ dueDate: '2026-08-31' }).status).toBe('overdue')
    expect(classify({ dueDate: '2026-09-01' }).status).toBe('due_soon')
    expect(classify({ dueDate: '2026-09-08' }).status).toBe('due_soon')
    expect(classify({ dueDate: '2026-09-09' }).status).toBe('open')
  })
})
