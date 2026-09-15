import { describe, it, expect } from 'vitest'
import { calculateAnchoredDays, type BalanceAnchor } from '@/lib/cash-flow/anchors'
import { aggregateByMonth } from '@/lib/cash-flow/aggregate'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'

const anchor = (date: string, balance: number, createdAt = date): BalanceAnchor => ({ date, balance, createdAt })
const entry = (date: string, amount: number, bucket: CashFlowEntry['bucket'] = 'realizado'): CashFlowEntry => ({ id: `${date}${amount}`, date, amount: Math.abs(amount), direction: amount < 0 ? 'saida' : 'entrada', bucket, origin: 'ledger', sourceId: 'test', description: null })

describe('closing cash anchors', () => {
  it('case A: 100000 → 105000 → 95000, without double counting anchor-day movements', () => {
    const days = calculateAnchoredDays([entry('2026-09-01', 999), entry('2026-09-02', 10000), entry('2026-09-02', -5000), entry('2026-09-03', 2000), entry('2026-09-03', -12000)], '2026-09-01', '2026-09-03', [anchor('2026-09-01', 100000)])
    expect(days.map(d => d.saldoFinal)).toEqual([100000, 105000, 95000])
  })
  it('case B: carries September closing balance into October, independent of range', () => {
    const entries = [entry('2026-10-01', 20000), entry('2026-10-01', -10000)]
    const anchors = [anchor('2026-09-30', 100000)]
    expect(calculateAnchoredDays(entries, '2026-10-01', '2026-10-01', anchors)[0].saldoFinal).toBe(110000)
    expect(aggregateByMonth(calculateAnchoredDays(entries, '2026-09-01', '2026-10-31', anchors)).map(m => m.saldoFinal)).toEqual([100000, 110000])
  })
  it('case C: preserves previous history and resets on each reconciliation', () => {
    const entries = [entry('2026-09-15', 15000), entry('2026-09-16', 777), entry('2026-09-17', 5000), entry('2026-09-17', -2000)]
    const anchors = [anchor('2026-09-01', 100000), anchor('2026-09-16', 110000)]
    expect(calculateAnchoredDays(entries, '2026-09-15', '2026-09-17', anchors).map(d => d.saldoFinal)).toEqual([115000, 110000, 113000])
  })
  it('carries all selected buckets across year boundaries', () => {
    const entries = [entry('2026-12-31', 2000, 'contratado'), entry('2027-01-01', -500, 'projetado')]
    const anchors = [anchor('2026-12-30', 100000)]
    const long = calculateAnchoredDays(entries, '2026-12-01', '2027-01-01', anchors)
    const short = calculateAnchoredDays(entries, '2027-01-01', '2027-01-01', anchors)
    expect(short[0].saldoFinal).toBe(101500)
    expect(short[0]).toEqual(long.at(-1))
  })
  it('leaves unknown balances null and uses the latest same-date reconciliation, including zero', () => {
    const anchors = [anchor('2026-09-02', 500, 'a'), anchor('2026-09-02', 0, 'b')]
    expect(calculateAnchoredDays([], '2026-09-01', '2026-09-03', anchors).map(d => d.saldoFinal)).toEqual([null, 0, 0])
  })
  it('applies adjustments once and excludes adjustments included in a later anchor', () => {
    const anchors = [anchor('2026-09-01', 100), anchor('2026-09-03', 120)]
    const adjustments = [{ date: '2026-09-02', amount: 10 }, { date: '2026-09-03', amount: 50 }]
    expect(calculateAnchoredDays([], '2026-09-01', '2026-09-04', anchors, adjustments).map(d => d.saldoFinal)).toEqual([100, 110, 120, 120])
  })
})
