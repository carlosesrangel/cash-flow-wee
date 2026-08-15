/**
 * Parses a bare SQL `date` string (YYYY-MM-DD) as a UTC calendar date, so
 * arithmetic never depends on the host machine's timezone. Mirrors the
 * pattern in `lib/reconciliation/run.ts`'s `shiftDateString` — do NOT
 * replace this with `new Date(dateStr)` + a timezone-aware formatter (e.g.
 * `formatDateBR`), which silently shifts a bare date backward by a day when
 * the local timezone is behind UTC (see that file's comment for the exact
 * failure mode).
 */
function toUtcDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function shiftDateString(dateStr: string, days: number): string {
  const date = toUtcDate(dateStr)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Positive when `dateStr` is after `todayStr`, negative when before. */
export function diffDaysFromToday(dateStr: string, todayStr: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((toUtcDate(dateStr).getTime() - toUtcDate(todayStr).getTime()) / msPerDay)
}
