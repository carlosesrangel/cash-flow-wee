export type MonthlyValue = { ano: number; mes: number; value: number }

function monthKey(ano: number, mes: number): string {
  return `${ano}-${mes}`
}

/**
 * Applies a scenario's monthly percentual multiplier to raw forecast
 * values. A (ano, mes) with no multiplier row is treated as 100% — never
 * dropped, since a scenario created before a version's months existed
 * would otherwise silently blank out those months instead of showing the
 * unmultiplied plan.
 */
export function applyScenario(entries: MonthlyValue[], multipliers: MonthlyValue[]): MonthlyValue[] {
  const multiplierMap = new Map(multipliers.map((m) => [monthKey(m.ano, m.mes), m.value]))
  return entries.map((entry) => {
    const percentual = multiplierMap.get(monthKey(entry.ano, entry.mes)) ?? 100
    return { ano: entry.ano, mes: entry.mes, value: (entry.value * percentual) / 100 }
  })
}
