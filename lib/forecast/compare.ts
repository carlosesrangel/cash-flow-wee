import type { MonthlyValue } from '@/lib/forecast/scenarios'

export type YearMonth = { ano: number; mes: number }

export type ForecastVsRealizadoRow = {
  ano: number
  mes: number
  planejado: number
  realizado: number | null
  diferencaAbsoluta: number | null
  diferencaPercentual: number | null
}

function monthKey(ano: number, mes: number): string {
  return `${ano}-${mes}`
}

function isBefore(a: YearMonth, b: YearMonth): boolean {
  return a.ano * 12 + a.mes < b.ano * 12 + b.mes
}

/**
 * Compares planned vs. actual revenue per month.
 *
 * `realizadoSums` only contains months that have at least one synced
 * `olist_orders` row (see `loadRealizadoByMonth`) — a month absent from it
 * means "no orders found for that month", which is ambiguous on its own:
 * for a month strictly before `today`, absence is a confirmed `0` (the
 * sync has had time to see everything for that month); for `today`'s
 * month or later, absence means the data doesn't exist yet and must not
 * be shown as if it were a confirmed zero — it resolves to `null`
 * ("—" in the UI, per Prompt Mestre seção 32).
 *
 * `diferencaPercentual` is `null` whenever `realizado` is `null` or
 * `planejado` is `0` — never a disguised divide-by-zero.
 */
export function compareForecastToActual(
  planejado: MonthlyValue[],
  realizadoSums: MonthlyValue[],
  today: YearMonth
): ForecastVsRealizadoRow[] {
  const realizadoMap = new Map(realizadoSums.map((r) => [monthKey(r.ano, r.mes), r.value]))

  return planejado.map((p) => {
    const month = { ano: p.ano, mes: p.mes }
    const known = realizadoMap.get(monthKey(p.ano, p.mes))
    const realizado = known !== undefined ? known : isBefore(month, today) ? 0 : null

    const diferencaAbsoluta = realizado === null ? null : realizado - p.value
    const diferencaPercentual = realizado === null || p.value === 0 ? null : (diferencaAbsoluta as number) / p.value

    return { ano: p.ano, mes: p.mes, planejado: p.value, realizado, diferencaAbsoluta, diferencaPercentual }
  })
}
