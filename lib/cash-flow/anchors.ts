import type { CashFlowEntry } from './engine'
import { aggregateByDay, type CashFlowDay } from './aggregate'

export type BalanceAnchor = { date: string; balance: number; createdAt: string }
export type BalanceAdjustment = { date: string; amount: number }

/** Snapshots are closing balances: that day's movements are already included.
 * Carry the same selected movements across every period boundary. O(entries + days).
 */
export function calculateAnchoredDays(
  entries: CashFlowEntry[], from: string, to: string,
  anchors: BalanceAnchor[], adjustments: BalanceAdjustment[] = [],
): CashFlowDay[] {
  const byDate = new Map<string, BalanceAnchor>()
  for (const anchor of [...anchors].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (anchor.date <= to) byDate.set(anchor.date, anchor)
  }
  const prior = [...byDate.values()].filter(a => a.date < from).sort((a, b) => b.date.localeCompare(a.date))[0]
  let balance: number | null = prior?.balance ?? null
  const net = (e: CashFlowEntry) => (e.direction === 'entrada' ? 1 : -1) * e.amount
  if (prior) {
    for (const entry of entries) if (entry.date > prior.date && entry.date < from) balance! += net(entry)
    for (const adjustment of adjustments) if (adjustment.date > prior.date && adjustment.date < from) balance! += adjustment.amount
  }
  const adjustmentsByDate = new Map<string, number>()
  for (const adjustment of adjustments) adjustmentsByDate.set(adjustment.date, (adjustmentsByDate.get(adjustment.date) ?? 0) + adjustment.amount)
  return aggregateByDay(entries, { from, to }, null).map(day => {
    const saldoInicial = balance
    const movement = Object.values(day.entradas).reduce((a, b) => a + b, 0) - Object.values(day.saidas).reduce((a, b) => a + b, 0)
    balance = byDate.get(day.date)?.balance ?? (balance === null ? null : balance + movement + (adjustmentsByDate.get(day.date) ?? 0))
    if (balance !== null) balance = Math.round((balance + Number.EPSILON) * 100) / 100
    return { ...day, saldoInicial, saldoFinal: balance }
  })
}
