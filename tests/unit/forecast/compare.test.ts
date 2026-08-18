import { describe, it, expect } from 'vitest'
import { compareForecastToActual } from '@/lib/forecast/compare'

describe('compareForecastToActual', () => {
  it('computes the R$ and % difference when both planejado and realizado exist', () => {
    const rows = compareForecastToActual(
      [{ ano: 2026, mes: 6, value: 1000 }],
      [{ ano: 2026, mes: 6, value: 1200 }],
      { ano: 2026, mes: 8 }
    )
    expect(rows).toEqual([
      { ano: 2026, mes: 6, planejado: 1000, realizado: 1200, diferencaAbsoluta: 200, diferencaPercentual: 0.2 },
    ])
  })

  it('treats a past month with no synced orders as realizado = 0, not null', () => {
    const rows = compareForecastToActual([{ ano: 2026, mes: 6, value: 1000 }], [], { ano: 2026, mes: 8 })
    expect(rows[0]).toMatchObject({ realizado: 0, diferencaAbsoluta: -1000 })
  })

  it('treats the current month with no synced orders as realizado = null (not confirmed zero yet)', () => {
    const rows = compareForecastToActual([{ ano: 2026, mes: 8, value: 1000 }], [], { ano: 2026, mes: 8 })
    expect(rows[0]).toMatchObject({ realizado: null, diferencaAbsoluta: null, diferencaPercentual: null })
  })

  it('treats a future month with no synced orders as realizado = null', () => {
    const rows = compareForecastToActual([{ ano: 2026, mes: 12, value: 1000 }], [], { ano: 2026, mes: 8 })
    expect(rows[0]).toMatchObject({ realizado: null, diferencaAbsoluta: null, diferencaPercentual: null })
  })

  it('never divides by zero: diferencaPercentual is null when planejado is 0', () => {
    const rows = compareForecastToActual([{ ano: 2026, mes: 6, value: 0 }], [{ ano: 2026, mes: 6, value: 500 }], {
      ano: 2026,
      mes: 8,
    })
    expect(rows[0]).toMatchObject({ diferencaAbsoluta: 500, diferencaPercentual: null })
  })

  it('produces one row per planejado month, in the same order', () => {
    const rows = compareForecastToActual(
      [
        { ano: 2026, mes: 6, value: 100 },
        { ano: 2026, mes: 7, value: 200 },
      ],
      [{ ano: 2026, mes: 7, value: 250 }],
      { ano: 2026, mes: 8 }
    )
    expect(rows.map((r) => r.mes)).toEqual([6, 7])
  })
})
