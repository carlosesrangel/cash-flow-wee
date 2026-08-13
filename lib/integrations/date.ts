const WEE_TIMEZONE = 'America/Sao_Paulo' as const

const olistDateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: WEE_TIMEZONE,
})

/**
 * Formats a Date as YYYY-MM-DD in the America/Sao_Paulo timezone, for use as
 * the value of an API date query param (e.g. `dataAtualizacao`).
 *
 * A naive `date.toISOString().slice(0, 10)` uses the UTC calendar date,
 * which can differ from the Brazil-local date by one day for times near
 * midnight UTC — silently making a `since`/window-start filter stricter or
 * looser than intended. This helper resolves the date in Brazil-local time.
 */
export function toLocalDateParam(date: Date): string {
  const parts = olistDateFormatter.formatToParts(date)
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${lookup('year')}-${lookup('month')}-${lookup('day')}`
}

/**
 * Some external APIs return "" (rather than omitting the key or returning null)
 * for unset date/timestamptz fields on some records, which Postgres rejects
 * as an invalid date/timestamptz literal. Normalize those to null before
 * upserting into any date/timestamptz-typed column.
 */
export function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null
}
