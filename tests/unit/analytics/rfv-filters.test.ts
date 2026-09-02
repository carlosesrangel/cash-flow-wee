import { describe, expect, it } from 'vitest'
import { matchesRFVFilters } from '@/lib/analytics/rfv-filters'

describe('cumulative RFV filters', () => {
  const row = { segment: 'Champions', daysSinceLastOrder: 45, orderCount: 3, lifetimeValue: 1500 }
  it('applies segment, recency, frequency and value together', () => {
    expect(matchesRFVFilters(row, { segment: 'Champions', recency: '30-60', frequency: '2-3', value: '1001-2000' })).toBe(true)
    expect(matchesRFVFilters(row, { segment: 'Champions', recency: '0-29', frequency: '2-3', value: '1001-2000' })).toBe(false)
  })
})
