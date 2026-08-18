import { describe, it, expect } from 'vitest'
import { aggregateByDay, aggregateByMonth, getMinimumProjectedBalance } from '@/lib/cash-flow/aggregate'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'

const entry = (overrides: Partial<CashFlowEntry> = {}): CashFlowEntry => ({
  id: 'e-1',
  origin: 'ar',
  sourceId: 's-1',
  date: '2026-08-15',
  amount: 100,
  direction: 'entrada',
  bucket: 'contratado',
  description: null,
  ...overrides,
})

describe('aggregateByDay', () => {
  it('produces one row per day in the range, even with no entries', () => {
    const days = aggregateByDay([], { from: '2026-08-14', to: '2026-08-16' }, null)
    expect(days.map((d) => d.date)).toEqual(['2026-08-14', '2026-08-15', '2026-08-16'])
  })

  it('has null saldoInicial/saldoFinal for every day when there is no opening balance', () => {
    const days = aggregateByDay([entry()], { from: '2026-08-15', to: '2026-08-15' }, null)
    expect(days[0].saldoInicial).toBeNull()
    expect(days[0].saldoFinal).toBeNull()
  })

  it('buckets entradas and saidas by direction and bucket on the correct day', () => {
    const days = aggregateByDay(
      [
        entry({ date: '2026-08-15', direction: 'entrada', bucket: 'realizado', amount: 50 }),
        entry({ date: '2026-08-15', direction: 'entrada', bucket: 'contratado', amount: 30 }),
        entry({ date: '2026-08-15', direction: 'saida', bucket: 'realizado', amount: 20 }),
        entry({ date: '2026-08-16', direction: 'saida', bucket: 'contratado', amount: 10 }),
      ],
      { from: '2026-08-15', to: '2026-08-16' },
      null
    )
    expect(days[0].entradas).toEqual({ realizado: 50, contratado: 30, projetado: 0 })
    expect(days[0].saidas).toEqual({ realizado: 20, contratado: 0, projetado: 0 })
    expect(days[1].entradas).toEqual({ realizado: 0, contratado: 0, projetado: 0 })
    expect(days[1].saidas).toEqual({ realizado: 0, contratado: 10, projetado: 0 })
  })

  it('ignores entries outside the requested range', () => {
    const days = aggregateByDay(
      [entry({ date: '2026-08-01' }), entry({ date: '2026-08-20' })],
      { from: '2026-08-14', to: '2026-08-16' },
      null
    )
    expect(days.every((d) => d.entradas.contratado === 0)).toBe(true)
  })

  it('carries saldoFinal forward as the next day\'s saldoInicial, proving saldoFinal = saldoInicial + entradas - saidas every day', () => {
    const days = aggregateByDay(
      [
        entry({ date: '2026-08-15', direction: 'entrada', bucket: 'realizado', amount: 100 }),
        entry({ date: '2026-08-16', direction: 'saida', bucket: 'realizado', amount: 40 }),
      ],
      { from: '2026-08-15', to: '2026-08-17' },
      { balance: 1000, asOf: '2026-08-14' }
    )
    expect(days[0]).toMatchObject({ saldoInicial: 1000, saldoFinal: 1100 })
    expect(days[1]).toMatchObject({ saldoInicial: 1100, saldoFinal: 1060 })
    expect(days[2]).toMatchObject({ saldoInicial: 1060, saldoFinal: 1060 })
    for (const day of days) {
      expect(day.saldoFinal).toBe(
        (day.saldoInicial as number) + day.entradas.realizado + day.entradas.contratado + day.entradas.projetado - day.saidas.realizado - day.saidas.contratado - day.saidas.projetado
      )
    }
  })
})

describe('aggregateByMonth', () => {
  it('sums entradas/saidas per month and keeps the last day\'s saldoFinal as the month-end balance', () => {
    const days = aggregateByDay(
      [
        entry({ date: '2026-08-30', direction: 'entrada', bucket: 'realizado', amount: 100 }),
        entry({ date: '2026-09-02', direction: 'saida', bucket: 'realizado', amount: 40 }),
      ],
      { from: '2026-08-30', to: '2026-09-02' },
      { balance: 0, asOf: '2026-08-29' }
    )
    const months = aggregateByMonth(days)
    expect(months).toEqual([
      { month: '2026-08', entradas: { realizado: 100, contratado: 0, projetado: 0 }, saidas: { realizado: 0, contratado: 0, projetado: 0 }, saldoFinal: 100 },
      { month: '2026-09', entradas: { realizado: 0, contratado: 0, projetado: 0 }, saidas: { realizado: 40, contratado: 0, projetado: 0 }, saldoFinal: 60 },
    ])
  })
})

describe('getMinimumProjectedBalance', () => {
  it('returns the day with the lowest saldoFinal, ignoring days with a null saldoFinal', () => {
    const days = aggregateByDay(
      [
        entry({ date: '2026-08-16', direction: 'saida', bucket: 'realizado', amount: 500 }),
        entry({ date: '2026-08-17', direction: 'entrada', bucket: 'realizado', amount: 500 }),
      ],
      { from: '2026-08-15', to: '2026-08-17' },
      { balance: 1000, asOf: '2026-08-14' }
    )
    expect(getMinimumProjectedBalance(days)).toEqual({ date: '2026-08-16', balance: 500 })
  })

  it('returns null when every day has a null saldoFinal', () => {
    const days = aggregateByDay([], { from: '2026-08-15', to: '2026-08-15' }, null)
    expect(getMinimumProjectedBalance(days)).toBeNull()
  })
})
