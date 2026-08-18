import { describe, it, expect } from 'vitest'
import { applyScenarioToPayment, mergePlannedPaymentsIntoFlow } from '@/lib/payments/scenarios'
import type { PlannedPaymentValue, AdjustedPayment } from '@/lib/payments/scenarios'

describe('applyScenarioToPayment', () => {
  const payment: PlannedPaymentValue = {
    apId: 'ap-1',
    value: 1000,
    dataVencimento: '2026-08-31',
    plannedDate: '2026-08-31',
  }

  it('returns payment unchanged when no adjustment', () => {
    const result = applyScenarioToPayment(payment)
    expect(result).toEqual({
      apId: 'ap-1',
      value: 1000,
      date: '2026-08-31',
      fromDate: '2026-08-31',
    })
  })

  it('delays payment by N days', () => {
    const result = applyScenarioToPayment(payment, { apId: 'ap-1', daysDelta: 15, percentage: 100 })
    expect(result.date).toBe('2026-09-15')
    expect(result.value).toBe(1000)
  })

  it('applies percentage to payment amount', () => {
    const result = applyScenarioToPayment(payment, { apId: 'ap-1', daysDelta: 0, percentage: 50 })
    expect(result.date).toBe('2026-08-31')
    expect(result.value).toBe(500)
  })

  it('combines delay and percentage', () => {
    const result = applyScenarioToPayment(payment, { apId: 'ap-1', daysDelta: 10, percentage: 75 })
    expect(result.date).toBe('2026-09-10')
    expect(result.value).toBe(750)
  })

  it('handles negative days_delta (delay)', () => {
    const result = applyScenarioToPayment(payment, { apId: 'ap-1', daysDelta: -20, percentage: 100 })
    expect(result.date).toBe('2026-08-11')
  })
})

describe('mergePlannedPaymentsIntoFlow', () => {
  const today = { ano: 2026, mes: 8 }
  const actualEntries = [
    {
      id: 'ap-actual',
      origin: 'ap' as const,
      sourceId: 'ap-1',
      date: '2026-08-15',
      amount: 500,
      direction: 'saida' as const,
      bucket: 'realizado' as const,
      description: 'Conta pagar realizada',
    },
  ]

  const plannedPayments: AdjustedPayment[] = [
    { apId: 'ap-2', value: 1000, date: '2026-08-25', fromDate: '2026-08-31' },
    { apId: 'ap-3', value: 500, date: '2026-09-10', fromDate: '2026-09-15' },
    { apId: 'ap-4', value: 200, date: '2026-07-31', fromDate: '2026-07-31' }, // past date, should be filtered
  ]

  it('includes only future payments', () => {
    const result = mergePlannedPaymentsIntoFlow(actualEntries, plannedPayments, today)
    const paymentEntries = result.filter((e) => e.origin === 'payment_plan')
    expect(paymentEntries).toHaveLength(2) // ap-2 and ap-3, not ap-4
    expect(paymentEntries[0].date).toBe('2026-08-25')
    expect(paymentEntries[1].date).toBe('2026-09-10')
  })

  it('merges with actual entries', () => {
    const result = mergePlannedPaymentsIntoFlow(actualEntries, plannedPayments, today)
    expect(result.length).toBeGreaterThan(actualEntries.length)
    expect(result.filter((e) => e.origin === 'ap')).toHaveLength(1) // actual
    expect(result.filter((e) => e.origin === 'payment_plan')).toHaveLength(2) // planned future
  })

  it('returns empty planned when no future payments', () => {
    const allPast = [{ apId: 'ap-old', value: 100, date: '2026-07-01', fromDate: '2026-07-01' }]
    const result = mergePlannedPaymentsIntoFlow(actualEntries, allPast, today)
    expect(result.filter((e) => e.origin === 'payment_plan')).toHaveLength(0)
  })
})
