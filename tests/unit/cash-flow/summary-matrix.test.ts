import { describe, expect, it } from 'vitest'
import { buildSummaryMatrix } from '@/lib/cash-flow/summary-matrix'

describe('cash flow summary matrix', () => {
  it('groups entries by category and produces totals/net flow', () => {
    const matrix = buildSummaryMatrix([
      { event_date: '2026-09-01', amount: 100, direction: 'entrada', nature: 'SUMUP', status: 'actual', metadata: null, description: 'Venda' },
      { event_date: '2026-09-01', amount: 40, direction: 'saida', nature: 'PROJECTED_CMV', status: 'projected', metadata: null, description: 'CMV projetado' },
      { event_date: '2026-09-02', amount: 10, direction: 'saida', nature: 'MANUAL_ENTRY', status: 'actual', metadata: { categoria: 'Aluguel' }, description: 'Aluguel' },
    ], 'month', '2026-09')
    expect(matrix.rows.map((row) => row.label)).toEqual(['Entradas', 'Aluguel', 'CMV'])
    expect(matrix.rows[0].values[0]).toBe(100)
    expect(matrix.totalSaidas[0]).toBe(40)
    expect(matrix.fluxoLiquido[0]).toBe(60)
  })
})
