import { describe, expect, it } from 'vitest'
import { buildPlanningMonthlySummary } from '@/lib/planning/monthly-summary'

describe('buildPlanningMonthlySummary', () => {
  it('keeps Jun, Jul and Aug rows labeled by planning month while attaching the factual receipt values', () => {
    const rows = buildPlanningMonthlySummary(
      [
        { ano: 2026, mes: 6, value: 11216.67 },
        { ano: 2026, mes: 7, value: 15584.01 },
        { ano: 2026, mes: 8, value: 12164 },
      ],
      [
        { month: '2026-06-01', realized: 999, pending: 999, invoiceCount: 99 },
        { month: '2026-07-01', realized: 1598.33, pending: 9618.34, invoiceCount: 19 },
        { month: '2026-08-01', realized: 3240, pending: 12344.01, invoiceCount: 26 },
        { month: '2026-09-01', realized: 1720, pending: 10444, invoiceCount: 21 },
      ],
    )

    expect(rows).toEqual([
      expect.objectContaining({ planningKey: '2026-06', realizado: 1598.33, pendente: 9618.34, faturas: 19 }),
      expect.objectContaining({ planningKey: '2026-07', realizado: 3240, pendente: 12344.01, faturas: 26 }),
      expect.objectContaining({ planningKey: '2026-08', realizado: 1720, pendente: 10444, faturas: 21 }),
    ])
  })
})
