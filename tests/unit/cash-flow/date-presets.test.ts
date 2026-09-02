import { describe, expect, it } from 'vitest'
import { getCashFlowDateRange } from '@/lib/cash-flow/date-presets'

describe('cash flow date presets', () => {
  it('handles calendar boundaries deterministically', () => {
    expect(getCashFlowDateRange('este-mes', '2026-09-15')).toEqual(['2026-09-01', '2026-09-30'])
    expect(getCashFlowDateRange('mes-anterior', '2026-01-15')).toEqual(['2025-12-01', '2025-12-31'])
    expect(getCashFlowDateRange('ano-anterior', '2026-09-15')).toEqual(['2025-01-01', '2025-12-31'])
  })
})
