import { describe, expect, it } from 'vitest'
import { firstDayOfNextMonth, isForecastAllowedOn } from '@/lib/forecast/cutoff'

describe('forecast cutoff', () => {
  const now = new Date('2026-09-30T23:30:00Z')
  it('uses Sao Paulo local month', () => expect(firstDayOfNextMonth(now)).toBe('2026-10-01'))
  it('excludes current month and permits only next month onward', () => {
    expect(isForecastAllowedOn('2026-09-30', now)).toBe(false)
    expect(isForecastAllowedOn('2026-10-01', now)).toBe(true)
  })
})
