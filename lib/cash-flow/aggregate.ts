import type { CashFlowEntry } from '@/lib/cash-flow/engine'
import { shiftDateString } from '@/lib/cash-flow/dates'

export type CashFlowDay = {
  date: string
  saldoInicial: number | null
  entradas: { realizado: number; contratado: number; projetado: number }
  saidas: { realizado: number; contratado: number; projetado: number }
  saldoFinal: number | null
}

/**
 * Aggregates a flat entry list into one row per calendar day in
 * `[range.from, range.to]` (inclusive), threading `saldoFinal` forward as
 * the next day's `saldoInicial`. When `opening` is null (no confirmed
 * balance exists yet — see `resolveOpeningBalance`), every day's
 * saldoInicial/saldoFinal stays null: showing flows without a running
 * balance is acceptable, fabricating one is not (Prompt Mestre seção 51).
 */
export function aggregateByDay(
  entries: CashFlowEntry[],
  range: { from: string; to: string },
  opening: { balance: number; asOf: string } | null
): CashFlowDay[] {
  const byDate = new Map<string, CashFlowEntry[]>()
  for (const entry of entries) {
    if (entry.date < range.from || entry.date > range.to) continue
    const list = byDate.get(entry.date) ?? []
    list.push(entry)
    byDate.set(entry.date, list)
  }

  const days: CashFlowDay[] = []
  let runningBalance = opening?.balance ?? null

  for (let date = range.from; date <= range.to; date = shiftDateString(date, 1)) {
    const dayEntries = byDate.get(date) ?? []
    const entradas = { realizado: 0, contratado: 0, projetado: 0 }
    const saidas = { realizado: 0, contratado: 0, projetado: 0 }
    for (const entry of dayEntries) {
      const target = entry.direction === 'entrada' ? entradas : saidas
      target[entry.bucket] += entry.amount
    }

    const saldoInicial = runningBalance
    const totalEntradas = entradas.realizado + entradas.contratado
    const totalSaidas = saidas.realizado + saidas.contratado
    const saldoFinal = saldoInicial === null ? null : saldoInicial + totalEntradas - totalSaidas

    days.push({ date, saldoInicial, entradas, saidas, saldoFinal })
    runningBalance = saldoFinal
  }

  return days
}

export type CashFlowMonth = {
  month: string
  entradas: { realizado: number; contratado: number; projetado: number }
  saidas: { realizado: number; contratado: number; projetado: number }
  saldoFinal: number | null
}

/** Folds a chronological `CashFlowDay[]` (as `aggregateByDay` produces) into one row per month. */
export function aggregateByMonth(days: CashFlowDay[]): CashFlowMonth[] {
  const byMonth = new Map<string, CashFlowMonth>()

  for (const day of days) {
    const month = day.date.slice(0, 7)
    const existing = byMonth.get(month) ?? {
      month,
      entradas: { realizado: 0, contratado: 0, projetado: 0 },
      saidas: { realizado: 0, contratado: 0, projetado: 0 },
      saldoFinal: null,
    }
    existing.entradas.realizado += day.entradas.realizado
    existing.entradas.contratado += day.entradas.contratado
    existing.entradas.projetado += day.entradas.projetado
    existing.saidas.realizado += day.saidas.realizado
    existing.saidas.contratado += day.saidas.contratado
    existing.saidas.projetado += day.saidas.projetado
    existing.saldoFinal = day.saldoFinal
    byMonth.set(month, existing)
  }

  return Array.from(byMonth.values())
}

/** The lowest saldoFinal across `days`, ignoring days with no confirmed balance yet. */
export function getMinimumProjectedBalance(days: CashFlowDay[]): { date: string; balance: number } | null {
  let min: { date: string; balance: number } | null = null
  for (const day of days) {
    if (day.saldoFinal === null) continue
    if (min === null || day.saldoFinal < min.balance) {
      min = { date: day.date, balance: day.saldoFinal }
    }
  }
  return min
}
