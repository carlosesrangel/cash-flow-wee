import { toLocalDateParam } from '@/lib/integrations/date'

export type MonthlyPlan = {
  competenceMonth: string
  amount: number
}

export type ScenarioConfig = {
  conservativePercent: number
  optimisticPercent: number
}

export const DEFAULT_SCENARIO_CONFIG: ScenarioConfig = {
  conservativePercent: 20,
  optimisticPercent: 30,
}

/** Values explicitly supplied in the phase brief. Used for import validation only. */
export const PLAN_REFERENCE_VALUES: Record<string, number> = {
  '2024-01': 17650,
  '2024-02': 13184.10,
  '2024-03': 13569,
  '2024-04': 30098,
  '2024-05': 15784,
  '2024-06': 30240,
  '2024-07': 25120,
  '2024-08': 90514.55,
  '2024-09': 40944.35,
  '2024-10': 6728.87,
  '2024-11': 28441,
  '2024-12': 73055.35,
  '2025-01': 13714,
  '2025-02': 10030,
  '2025-03': 13745,
  '2025-04': 39519,
  '2025-05': 61659,
  '2025-06': 20799,
  '2025-07': 42641.60,
  '2025-08': 44338.61,
  '2025-09': 7640,
  '2025-10': 18480,
  '2025-11': 18129,
  '2025-12': 88493.92,
  '2026-01': 9820,
  '2026-02': 21795,
  '2026-03': 30874,
  '2026-04': 48504,
  '2026-05': 12744,
  '2026-06': 35500,
  '2026-07': 42500,
  '2026-08': 77500,
  '2026-09': 39500,
  '2026-10': 55000,
  '2026-11': 55000,
  '2026-12': 115000,
  '2027-01': 27000,
  '2027-02': 45000,
  '2027-03': 45000,
  '2027-04': 57000,
  '2027-05': 65000,
  '2027-06': 55000,
  '2027-07': 55000,
  '2027-08': 105000,
  '2027-09': 60000,
  '2027-10': 67000,
  '2027-11': 75000,
  '2027-12': 135000,
  '2028-01': 73000,
  '2028-02': 93000,
  '2028-03': 143000,
  '2028-04': 113000,
  '2028-05': 118000,
  '2028-06': 165000,
  '2028-07': 105000,
  '2028-08': 175000,
  '2028-09': 165000,
  '2028-10': 130000,
  '2028-11': 135000,
  '2028-12': 205000,
  '2029-01': 135000,
  '2029-02': 155000,
  '2029-03': 305000,
  '2029-04': 175000,
  '2029-05': 190000,
  '2029-06': 280000,
  '2029-07': 165000,
  '2029-08': 255000,
  '2029-09': 315000,
  '2029-10': 190000,
  '2029-11': 195000,
  '2029-12': 280000,
  '2030-01': 195000,
  '2030-02': 225000,
  '2030-03': 470000,
  '2030-04': 240000,
  '2030-05': 260000,
  '2030-06': 390000,
  '2030-07': 215000,
  '2030-08': 330000,
  '2030-09': 475000,
  '2030-10': 250000,
  '2030-11': 270000,
  '2030-12': 350000,
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function isFutureCompetence(competenceMonth: string, now = new Date()): boolean {
  return competenceMonth.slice(0, 7) > toLocalDateParam(now).slice(0, 7)
}

export function isPlanEditable(competenceMonth: string, now = new Date()): boolean {
  return isFutureCompetence(competenceMonth, now)
}

export function applyScenarioToPlan(
  plans: MonthlyPlan[],
  scenario: 'base' | 'conservative' | 'optimistic',
  config: ScenarioConfig = DEFAULT_SCENARIO_CONFIG,
  now = new Date(),
): MonthlyPlan[] {
  const factor = scenario === 'conservative' ? 1 - config.conservativePercent / 100 : scenario === 'optimistic' ? 1 + config.optimisticPercent / 100 : 1
  return plans.map((plan) => ({
    ...plan,
    amount: isFutureCompetence(plan.competenceMonth, now) ? roundCents(plan.amount * factor) : plan.amount,
  }))
}

export type ProjectedCmv = {
  competenceMonth: string
  total: number
  day1: number
  day15: number
}

export function calculateProjectedCmv(revenue: number, competenceMonth: string): ProjectedCmv {
  const total = roundCents((revenue / 3.1) * 1.1)
  const day1 = roundCents(total / 2)
  return { competenceMonth, total, day1, day15: roundCents(total - day1) }
}

export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
