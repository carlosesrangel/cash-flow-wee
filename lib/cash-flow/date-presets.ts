export type CashFlowDatePreset = 'ontem' | 'hoje' | 'este-mes' | 'mes-anterior' | 'este-ano' | 'ano-anterior' | 'proximo-mes' | 'proximos-30' | 'ultimos-30'

function iso(date: Date) { return date.toISOString().slice(0, 10) }
function at(today: string) { return new Date(`${today}T00:00:00Z`) }
function firstOfMonth(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)) }
function lastOfMonth(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)) }

export function getCashFlowDateRange(preset: CashFlowDatePreset, today: string): [string, string] {
  const date = at(today)
  switch (preset) {
    case 'ontem': { const d = new Date(date); d.setUTCDate(d.getUTCDate() - 1); return [iso(d), iso(d)] }
    case 'hoje': return [today, today]
    case 'este-mes': return [iso(firstOfMonth(date)), iso(lastOfMonth(date))]
    case 'mes-anterior': { const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)); return [iso(d), iso(lastOfMonth(d))] }
    case 'este-ano': return [`${date.getUTCFullYear()}-01-01`, `${date.getUTCFullYear()}-12-31`]
    case 'ano-anterior': return [`${date.getUTCFullYear() - 1}-01-01`, `${date.getUTCFullYear() - 1}-12-31`]
    case 'proximo-mes': { const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)); return [iso(d), iso(lastOfMonth(d))] }
    case 'proximos-30': { const end = new Date(date); end.setUTCDate(end.getUTCDate() + 30); return [today, iso(end)] }
    case 'ultimos-30': { const start = new Date(date); start.setUTCDate(start.getUTCDate() - 30); return [iso(start), today] }
  }
}
