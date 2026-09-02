import { describe, expect, it } from 'vitest'
import { PLAN_REFERENCE_VALUES, applyScenarioToPlan, calculateProjectedCmv, isPlanEditable } from '@/lib/planning/canonical'

describe('canonical planning rules', () => {
  it('keeps the current competence read-only and the next month editable', () => {
    const now = new Date('2026-09-15T12:00:00-03:00')
    expect(isPlanEditable('2026-09-01', now)).toBe(false)
    expect(isPlanEditable('2026-10-01', now)).toBe(true)
  })
  it('retains the factual 2030-12 reference value without manufacturing earlier missing rows', () => {
    expect(PLAN_REFERENCE_VALUES['2030-12']).toBe(350000)
    expect(PLAN_REFERENCE_VALUES['2024-01']).toBeUndefined()
  })
  it('applies scenarios only to future competencies', () => {
    const plans = [{ competenceMonth: '2026-09-01', amount: 100 }, { competenceMonth: '2026-10-01', amount: 100 }]
    expect(applyScenarioToPlan(plans, 'conservative', { conservativePercent: 20, optimisticPercent: 30 }, new Date('2026-09-15T12:00:00-03:00')).map((p) => p.amount)).toEqual([100, 80])
  })
  it('uses the specified CMV formula and cent-balanced split', () => {
    expect(calculateProjectedCmv(39500, '2026-10-01')).toEqual({ competenceMonth: '2026-10-01', total: 14016.13, day1: 7008.07, day15: 7008.06 })
  })
})
