import { describe, it, expect } from 'vitest'
import { toLocalDateParam } from '@/lib/integrations/date'

describe('toLocalDateParam', () => {
  it('formats a UTC timestamp still within the same local calendar day', () => {
    // 2026-08-12T23:30:00Z is 2026-08-12T20:30:00-03:00 in Sao Paulo — still the 12th locally.
    expect(toLocalDateParam(new Date('2026-08-12T23:30:00Z'))).toBe('2026-08-12')
  })

  it('does not roll forward to the UTC date when local date is still the previous day', () => {
    // 2026-08-13T01:00:00Z is 2026-08-12T22:00:00-03:00 in Sao Paulo — the 12th locally,
    // but the 13th in UTC. A naive toISOString().slice(0, 10) would incorrectly return 2026-08-13.
    expect(toLocalDateParam(new Date('2026-08-13T01:00:00Z'))).toBe('2026-08-12')
  })
})
