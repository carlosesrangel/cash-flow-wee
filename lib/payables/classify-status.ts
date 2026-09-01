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
  // Normalize inputs
  const normalizedSituacao = situacao?.toLowerCase().trim() || ''
  const openBalance = Number(saldo) || 0
  const totalValue = Number(valor) || 0

  // Get today in org timezone
  const today = getTodayInTimezone(orgTimezone)

  // Check if cancelled
  if (normalizedSituacao === 'cancelada' || normalizedSituacao === 'canceled') {
    return {
      status: 'cancelled',
      label: 'Cancelada',
      color: 'gray',
      priority: 0,
    }
  }

  // Check if paid
  // Precedence: situacao='pago' OR (saldo <= 0 AND valor > 0)
  const isPaid = normalizedSituacao === 'pago' || openBalance <= 0
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

  const dueDate = normalizeDate(dataVencimento)
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
  return new Date(year, month, day)
}

/**
 * Normalize date input
 */
function normalizeDate(date: string | Date): Date {
  if (typeof date === 'string') {
    return new Date(date + 'T00:00:00Z') // Treat as UTC date string
  }
  return date
}

/**
 * Days between two dates (negative if first date is before second)
 */
function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000
  const diffTime = date2.getTime() - date1.getTime()
  return Math.floor(diffTime / oneDay)
}
