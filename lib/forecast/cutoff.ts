import { toLocalDateParam } from '@/lib/integrations/date'

export function firstDayOfNextMonth(now = new Date()): string {
  const local = toLocalDateParam(now)
  const [year, month] = local.slice(0, 7).split('-').map(Number)
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export function isForecastAllowedOn(cashEventDate: string, now = new Date()): boolean {
  return cashEventDate >= firstDayOfNextMonth(now)
}
