import { describe, expect, it } from 'vitest'
import { calculateDashboardKpis } from '@/lib/cash-flow/dashboard-kpis'
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'

const day = (date: string, saldoFinal: number): CashFlowDay => ({
  date,
  saldoInicial: saldoFinal - 10,
  saldoFinal,
  entradas: { realizado: 10, contratado: 20, projetado: 30 },
  saidas: { realizado: 4, contratado: 5, projetado: 6 },
})

describe('calculateDashboardKpis', () => {
  it('is the golden dashboard calculation over the canonical day series', () => {
    const result = calculateDashboardKpis(
      [day('2026-09-01', 100), day('2026-09-15', 121), day('2026-10-01', 142)],
      '2026-09-01',
      4000,
    )

    expect(result).toEqual({
      saldoAtual: 4000,
      entradas30: 90,
      saidas30: 27,
      saldoEm30: 142,
      entradasRealizadas: 30,
      entradasContratadasProjetadas: 150,
      saidasRealizadas: 12,
      saidasContratadasProjetadas: 33,
    })
  })
})
