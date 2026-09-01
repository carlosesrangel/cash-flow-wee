export type PlanningSummaryEntry = {
  ano: number
  mes: number
  value: number
}

export type MonthlyReceiptSummary = {
  month: string
  realized: number
  pending: number
  invoiceCount: number
}

export type PlanningMonthlySummaryRow = PlanningSummaryEntry & {
  planningKey: string
  total: number
  realizado: number | null
  pendente: number | null
  faturas: number | null
}

function monthKey(year: number, month: number) {
  const date = new Date(Date.UTC(year, month - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Attach receipt results to the month in which the planning target was made.
 *
 * Forecast entries represent the sale/competence month. The monthly revenue
 * view represents the receipt month (`data_vencimento`), so this intentional
 * one-month bridge preserves the business convention and the seeded Jun-Aug
 * dashboard values. Keeping it here makes the mapping testable instead of
 * hiding the offset inside the page component.
 */
export function buildPlanningMonthlySummary(
  entries: PlanningSummaryEntry[],
  monthlyReceipts: MonthlyReceiptSummary[],
  settlementOffsetMonths = 1,
): PlanningMonthlySummaryRow[] {
  const receiptsByKey = new Map(monthlyReceipts.map((month) => [month.month.slice(0, 7), month]))

  return entries.map((entry) => {
    const planningKey = monthKey(entry.ano, entry.mes)
    const receiptMonth = new Date(Date.UTC(entry.ano, entry.mes - 1 + settlementOffsetMonths, 1))
    const receiptKey = monthKey(receiptMonth.getUTCFullYear(), receiptMonth.getUTCMonth() + 1)
    const receipt = receiptsByKey.get(receiptKey)

    return {
      ...entry,
      planningKey,
      total: entry.value,
      realizado: receipt?.realized ?? null,
      pendente: receipt?.pending ?? null,
      faturas: receipt?.invoiceCount ?? null,
    }
  })
}
