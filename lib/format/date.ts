export const WEE_TIMEZONE = 'America/Sao_Paulo' as const

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: WEE_TIMEZONE,
})

export function formatDateBR(date: Date | string): string {
  const parsed = typeof date === 'string' ? new Date(date) : date
  return dateFormatter.format(parsed)
}

/**
 * Formats a bare SQL `date` string (YYYY-MM-DD) as DD/MM/YYYY by splitting
 * its parts directly — never via `new Date(dateStr)` + a timezone-aware
 * formatter (that's what `formatDateBR` does, correctly, for real
 * `timestamptz` values — but a bare date has no time component, so the
 * Date constructor treats it as UTC midnight, and formatting that in
 * America/Sao_Paulo (UTC-3) silently displays the day *before* the actual
 * date). Use this for any bare `YYYY-MM-DD` string (cash flow dates,
 * `data_vencimento`, etc.) — use `formatDateBR` only for real timestamps.
 */
export function formatDateOnlyBR(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}
