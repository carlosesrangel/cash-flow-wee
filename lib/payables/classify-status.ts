/**
 * Canonical payable status classification - matches Tiny/WEE conventions
 * Uses America/Sao_Paulo timezone for date comparisons
 */

export type PayableStatus = 'paid' | 'overdue' | 'due_soon' | 'open' | 'cancelled'

export interface PayableStatusResult {
  status: PayableStatus
  label: string
  color: 'gray' | 'red' | 'yellow' | 'green'
  priority: number // for sorting
}

export function classifyPayableStatus(
  situacao: string | null | undefined,
  saldo: number | null | undefined,
  valor: number | null | undefined,
  dataVencimento: string | Date | null | undefined,
  dataLiquidacao: string | Date | null | undefined = null,
  orgTimezone: string = 'America/Sao_Paulo'
): PayableStatusResult {
  const normalizedSituacao = situacao?.toLowerCase().trim() || ''
  const hasKnownBalance = saldo !== null && saldo !== undefined && Number.isFinite(Number(saldo))
  const hasKnownValue = valor !== null && valor !== undefined && Number.isFinite(Number(valor))
  const openBalance = hasKnownBalance ? Number(saldo) : null
  const totalValue = hasKnownValue ? Number(valor) : null

  // Get today in org timezone
  const today = getTodayInTimezone(orgTimezone)

  // Check if cancelled
  if (['cancelada', 'cancelado', 'canceled', 'cancelled'].includes(normalizedSituacao)) {
    return {
      status: 'cancelled',
      label: 'Cancelada',
      color: 'gray',
      priority: 6,
    }
  }

  // A paid status is factual when the ERP says "pago", or when both numeric
  // fields are known and the obligation has no remaining balance. A missing
  // balance is intentionally not treated as zero.
  const isPaid = normalizedSituacao === 'pago' ||
    (openBalance !== null && openBalance <= 0 && totalValue !== null && totalValue > 0)
  if (isPaid) {
    return {
      status: 'paid',
      label: 'Paga',
      color: 'gray',
      priority: 5,
    }
  }

  // From here on, account is OPEN (situacao='aberto' or equivalent)
  if (!dataVencimento) {
    // No due date: default to open
    return {
      status: 'open',
      label: 'Em aberto',
      color: 'green',
      priority: 4,
    }
  }

  const dueDate = normalizeDate(dataVencimento, orgTimezone)
  if (!dueDate) {
    return {
      status: 'open',
      label: 'Em aberto',
      color: 'green',
      priority: 4,
    }
  }
  const daysUntilDue = daysBetween(today, dueDate)

  // Check if overdue
  if (daysUntilDue < 0) {
    return {
      status: 'overdue',
      label: 'Atrasada',
      color: 'red',
      priority: 1,
    }
  }

  // Check if due soon (next 7 days)
  if (daysUntilDue >= 0 && daysUntilDue <= 7) {
    return {
      status: 'due_soon',
      label: 'Vence em até 7 dias',
      color: 'yellow',
      priority: 2,
    }
  }

  // Open (beyond 7 days)
  return {
    status: 'open',
    label: 'Em aberto',
    color: 'green',
    priority: 4,
  }
}

/**
 * Get today's date in specified timezone
 */
function getTodayInTimezone(timezone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(new Date())
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '2026')
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '1') - 1
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '1')
  return dateOnlyToUtcEpoch(year, month + 1, day)
}

/**
 * Normalize date input
 */
function normalizeDate(date: string | Date, timezone: string): Date | null {
  if (typeof date === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
    if (!match) return null
    return dateOnlyToUtcEpoch(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  if (Number.isNaN(date.getTime())) return null
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)
  if (![year, month, day].every(Number.isFinite)) return null
  return dateOnlyToUtcEpoch(year, month, day)
}

/**
 * Days between two dates (negative if first date is before second)
 */
function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000
  const diffTime = date2.getTime() - date1.getTime()
  return Math.floor(diffTime / oneDay)
}

function dateOnlyToUtcEpoch(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}
