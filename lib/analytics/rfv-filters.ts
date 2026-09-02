export const RECENCY_FILTERS = [
  ['0-29', 'Menos de 1 mês', 0, 29], ['30-60', '1 a 2 meses', 30, 60], ['61-90', '2 a 3 meses', 61, 90], ['91-180', '4 a 6 meses', 91, 180], ['181-365', '6 a 12 meses', 181, 365], ['366-730', '1 a 2 anos', 366, 730], ['731+', 'Mais de 2 anos', 731, Infinity],
] as const
export const FREQUENCY_FILTERS = [['1', '1 vez', 1, 1], ['2-3', '2 ou 3 vezes', 2, 3], ['4-6', '4 a 6 vezes', 4, 6], ['7-10', '7 a 10 vezes', 7, 10], ['11+', '11 vezes ou mais', 11, Infinity]] as const
export const VALUE_FILTERS = [['0-1000', 'Até R$ 1.000', 0, 1000], ['1001-2000', 'R$ 1.001 a R$ 2.000', 1001, 2000], ['2001-3000', 'R$ 2.001 a R$ 3.000', 2001, 3000], ['3001-5000', 'R$ 3.001 a R$ 5.000', 3001, 5000], ['5001-10000', 'R$ 5.001 a R$ 10.000', 5001, 10000], ['10001+', 'Acima de R$ 10.000', 10001, Infinity]] as const

export type RFVFilterState = { segment?: string; recency?: string; frequency?: string; value?: string }

export function matchesRFVFilters(row: { segment: string; daysSinceLastOrder?: number; orderCount: number; lifetimeValue: number }, filters: RFVFilterState) {
  if (filters.segment && row.segment !== filters.segment) return false
  const recency = RECENCY_FILTERS.find((item) => item[0] === filters.recency)
  const frequency = FREQUENCY_FILTERS.find((item) => item[0] === filters.frequency)
  const value = VALUE_FILTERS.find((item) => item[0] === filters.value)
  if (recency && (row.daysSinceLastOrder == null || row.daysSinceLastOrder < recency[2] || row.daysSinceLastOrder > recency[3])) return false
  if (frequency && (row.orderCount < frequency[2] || row.orderCount > frequency[3])) return false
  if (value && (row.lifetimeValue < value[2] || row.lifetimeValue > value[3])) return false
  return true
}
