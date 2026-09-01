import { classifyPayableStatus } from '../classify-status'

describe('classifyPayableStatus', () => {
  const today = new Date()
  const tomorrow = new Date(today.getTime() + 86400000)
  const nextWeek = new Date(today.getTime() + 7 * 86400000)
  const twoWeeks = new Date(today.getTime() + 14 * 86400000)
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)

  it('classifies PAID account correctly', () => {
    const result = classifyPayableStatus('pago', 0, 1000, yesterday)
    expect(result.status).toBe('paid')
    expect(result.label).toBe('Paga')
    expect(result.color).toBe('gray')
  })

  it('classifies OVERDUE account', () => {
    const result = classifyPayableStatus('aberto', 500, 1000, yesterday)
    expect(result.status).toBe('overdue')
    expect(result.label).toBe('Atrasada')
    expect(result.color).toBe('red')
  })

  it('classifies DUE_SOON account (within 7 days)', () => {
    const in3Days = new Date(today.getTime() + 3 * 86400000)
    const result = classifyPayableStatus('aberto', 500, 1000, in3Days)
    expect(result.status).toBe('due_soon')
    expect(result.label).toBe('Vence em até 7 dias')
    expect(result.color).toBe('yellow')
  })

  it('classifies DUE_SOON at boundary (7 days)', () => {
    const result = classifyPayableStatus('aberto', 500, 1000, nextWeek)
    expect(result.status).toBe('due_soon')
  })

  it('classifies OPEN account (beyond 7 days)', () => {
    const result = classifyPayableStatus('aberto', 500, 1000, twoWeeks)
    expect(result.status).toBe('open')
    expect(result.label).toBe('Em aberto')
    expect(result.color).toBe('green')
  })

  it('classifies CANCELLED account', () => {
    const result = classifyPayableStatus('cancelada', 0, 1000, tomorrow)
    expect(result.status).toBe('cancelled')
    expect(result.label).toBe('Cancelada')
  })

  it('paid takes precedence: situacao=pago even with future due date', () => {
    const result = classifyPayableStatus('pago', 0, 1000, twoWeeks)
    expect(result.status).toBe('paid')
  })

  it('paid by saldo: saldo <= 0 means paid regardless of situacao', () => {
    const result = classifyPayableStatus('aberto', 0, 1000, yesterday)
    expect(result.status).toBe('paid')
  })

  it('handles null/undefined inputs', () => {
    const result = classifyPayableStatus(null, undefined, 1000, twoWeeks)
    expect(result.status).toBe('open')
  })

  it('defaults to OPEN when no due date', () => {
    const result = classifyPayableStatus('aberto', 500, 1000, null)
    expect(result.status).toBe('open')
  })

  it('priority is correct for sorting', () => {
    const paid = classifyPayableStatus('pago', 0, 1000, yesterday)
    const overdue = classifyPayableStatus('aberto', 500, 1000, yesterday)
    const dueSoon = classifyPayableStatus('aberto', 500, 1000, tomorrow)
    const open = classifyPayableStatus('aberto', 500, 1000, twoWeeks)

    expect(paid.priority > overdue.priority).toBe(true)
    expect(overdue.priority > dueSoon.priority).toBe(true)
    expect(dueSoon.priority > open.priority).toBe(true)
  })
})
