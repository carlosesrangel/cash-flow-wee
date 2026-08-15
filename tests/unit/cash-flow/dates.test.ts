import { describe, it, expect } from 'vitest'
import { shiftDateString, diffDaysFromToday } from '@/lib/cash-flow/dates'

describe('shiftDateString', () => {
  it('adds days, rolling over the month boundary', () => {
    expect(shiftDateString('2026-08-30', 3)).toBe('2026-09-02')
  })

  it('subtracts days, rolling under the month boundary', () => {
    expect(shiftDateString('2026-09-02', -3)).toBe('2026-08-30')
  })

  it('is a no-op for zero days', () => {
    expect(shiftDateString('2026-08-15', 0)).toBe('2026-08-15')
  })
})

describe('diffDaysFromToday', () => {
  it('returns a positive number for a future date', () => {
    expect(diffDaysFromToday('2026-08-20', '2026-08-15')).toBe(5)
  })

  it('returns a negative number for a past date', () => {
    expect(diffDaysFromToday('2026-08-10', '2026-08-15')).toBe(-5)
  })

  it('returns zero when the dates are the same', () => {
    expect(diffDaysFromToday('2026-08-15', '2026-08-15')).toBe(0)
  })
})
