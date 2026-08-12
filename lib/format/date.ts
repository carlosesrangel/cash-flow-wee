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
