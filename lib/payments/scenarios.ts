import type { CashFlowEntry } from '@/lib/cash-flow/engine'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

/**
 * Represents a payment (AP account) with its planned date and amount.
 * Used as input to scenario calculations.
 */
export type PlannedPaymentValue = {
  apId: string
  value: number // payment amount
  dataVencimento: string // original due date (YYYY-MM-DD)
  plannedDate: string // originally planned payment date (YYYY-MM-DD)
}

/**
 * Adjustment applied to a payment in a specific scenario.
 */
export type PaymentAdjustment = {
  apId: string
  daysDelta: number // shift payment date by N days (negative = delay)
  percentage: number // pay X% (0-100) instead of full amount
}

/**
 * Result of applying scenario adjustments to a payment.
 */
export type AdjustedPayment = {
  apId: string
  value: number // adjusted amount (original * percentage)
  date: string // adjusted date (YYYY-MM-DD)
  fromDate: string // original planned date (for UI comparison)
}

/**
 * Applies scenario adjustments to a single payment.
 * Pure function: no side effects, deterministic.
 */
export function applyScenarioToPayment(
  payment: PlannedPaymentValue,
  adjustment?: PaymentAdjustment
): AdjustedPayment {
  if (!adjustment) {
    // No adjustment: use planned date as-is
    return {
      apId: payment.apId,
      value: payment.value,
      date: payment.plannedDate,
      fromDate: payment.plannedDate,
    }
  }

  // Apply days_delta to shift the date
  const dateObj = new Date(`${payment.plannedDate}T00:00:00Z`)
  dateObj.setUTCDate(dateObj.getUTCDate() + adjustment.daysDelta)
  const adjustedDate = dateObj.toISOString().split('T')[0]

  // Apply percentage to adjust amount
  const adjustedValue = (payment.value * adjustment.percentage) / 100

  return {
    apId: payment.apId,
    value: adjustedValue,
    date: adjustedDate,
    fromDate: payment.plannedDate,
  }
}

/**
 * Merges planned payments (adjusted by scenario) into actual cash-flow entries.
 * Only includes payments dated today or later (doesn't overlay past).
 */
export function mergePlannedPaymentsIntoFlow(
  actualEntries: CashFlowEntry[],
  plannedPayments: AdjustedPayment[],
  today: { ano: number; mes: number }
): CashFlowEntry[] {
  // Filter planned payments to future-only
  const futurePayments = plannedPayments.filter((p) => {
    const [ano, mes, dia] = p.date.split('-').map(Number)
    if (ano > today.ano) return true
    if (ano === today.ano && mes > today.mes) return true
    if (ano === today.ano && mes === today.mes && dia >= 1) return true // include today
    return false
  })

  // Convert to CashFlowEntry items
  const paymentEntries: CashFlowEntry[] = futurePayments.map((p) => ({
    id: `payment-plan-${p.apId}-${p.date}`,
    origin: 'payment_plan' as const,
    sourceId: p.apId,
    date: p.date,
    amount: p.value,
    direction: 'saida' as const,
    bucket: 'projetado' as const,
    description: `Pagamento Planejado - ${p.date}`,
  }))

  return [...actualEntries, ...paymentEntries]
}
