import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadCashFlowEntries, resolveOpeningBalance, type CashFlowEntry } from '@/lib/cash-flow/engine'
import { loadPlannedPayments, loadPaymentScenarios } from '@/lib/payments/engine'
import { mergePlannedPaymentsIntoFlow } from '@/lib/payments/scenarios'
import type { PlannedPaymentValue, PaymentAdjustment } from '@/lib/payments/scenarios'

/**
 * Load actual cash flow entries merged with planned payments.
 * Used by Fluxo de Caixa pages to show both actual and planned saidas.
 */
export async function loadCashFlowWithPlannedPayments(
  orgId: string,
  scenarioId?: string,
  includePlanned: boolean = true
): Promise<CashFlowEntry[]> {
  const actualEntries = await loadCashFlowEntries(orgId)

  if (!includePlanned) return actualEntries

  const admin = createAdminSupabaseClient()
  const plannedPayments = await loadPlannedPayments(orgId)

  if (plannedPayments.length === 0) return actualEntries

  // Load AP details for each planned payment
  const apIds = plannedPayments.map((p) => p.apId)
  const { data: apDetails } = await admin
    .from('olist_accounts_payable')
    .select('id, valor, data_vencimento')
    .in('id', apIds)

  const apDetailsMap = new Map(
    (apDetails || []).map((ap) => [ap.id, { value: ap.valor || 0, dataVencimento: ap.data_vencimento || '' }])
  )

  // Convert planned payments to adjusted payments
  const paymentValues: PlannedPaymentValue[] = plannedPayments.map((pp) => {
    const details = apDetailsMap.get(pp.apId) || { value: 0, dataVencimento: '' }
    return {
      apId: pp.apId,
      value: details.value,
      dataVencimento: details.dataVencimento,
      plannedDate: pp.plannedDate,
    }
  })

  // Load scenario adjustments if specified
  let adjustments: PaymentAdjustment[] = []
  if (scenarioId) {
    const scenarios = await loadPaymentScenarios(orgId)
    const scenario = scenarios.find((s) => s.scenario.id === scenarioId)
    if (scenario) {
      adjustments = scenario.adjustments
    }
  }

  // Calculate adjusted payments and merge
  const now = new Date()
  const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const today = { ano: brazilTime.getFullYear(), mes: brazilTime.getMonth() + 1 }

  const adjustedPayments = paymentValues
    .map((pv) => {
      const adjustment = adjustments.find((a) => a.apId === pv.apId)
      const adjusted = {
        apId: pv.apId,
        value: (pv.value * (adjustment?.percentage ?? 100)) / 100,
        date: adjustment?.daysDelta ? shiftDate(pv.plannedDate, adjustment.daysDelta) : pv.plannedDate,
        fromDate: pv.plannedDate,
      }
      return adjusted
    })
    .filter((p) => {
      const [ano, mes] = p.date.split('-').map(Number)
      if (ano > today.ano) return true
      if (ano === today.ano && mes >= today.mes) return true
      return false
    })

  return mergePlannedPaymentsIntoFlow(actualEntries, adjustedPayments, today)
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}
