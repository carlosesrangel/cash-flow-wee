import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { applyScenarioToPayment } from '@/lib/payments/scenarios'
import type { PaymentAdjustment, PlannedPaymentValue, AdjustedPayment } from '@/lib/payments/scenarios'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type PlannedPayment = {
  apId: string
  plannedDate: string
  createdBy: string | null
  createdAt: string
}

export type PaymentScenario = {
  id: string
  orgId: string
  name: string
  description: string | null
  isDefault: boolean
  createdBy: string | null
  createdAt: string
}

type PlannedPaymentRow = {
  ap_id: string
  planned_date: string
  created_by: string | null
  created_at: string
}

type PaymentScenarioRow = {
  id: string
  org_id: string
  name: string
  description: string | null
  is_default: boolean
  created_by: string | null
  created_at: string
}

type AdjustmentRow = {
  scenario_id: string
  ap_id: string
  days_delta: number
  percentage: number
}

/**
 * Load all planned payments for an org.
 */
export async function loadPlannedPayments(orgId: string): Promise<PlannedPayment[]> {
  const admin = createAdminSupabaseClient()
  const rows = await fetchAllPages<PlannedPaymentRow>(
    (from, to) =>
      admin
        .from('planned_payments')
        .select('ap_id, planned_date, created_by, created_at')
        .eq('org_id', orgId)
        .range(from, to),
    'Failed to load planned_payments'
  )
  return rows.map((r) => ({ apId: r.ap_id, plannedDate: r.planned_date, createdBy: r.created_by, createdAt: r.created_at }))
}

/**
 * Load all payment scenarios for an org (with nested adjustments).
 */
export async function loadPaymentScenarios(orgId: string): Promise<Array<{ scenario: PaymentScenario; adjustments: PaymentAdjustment[] }>> {
  const admin = createAdminSupabaseClient()
  const scenarios = await fetchAllPages<PaymentScenarioRow>(
    (from, to) =>
      admin
        .from('payment_scenarios')
        .select('id, org_id, name, description, is_default, created_by, created_at')
        .eq('org_id', orgId)
        .order('created_at')
        .range(from, to),
    'Failed to load payment_scenarios'
  )

  const result: Array<{ scenario: PaymentScenario; adjustments: PaymentAdjustment[] }> = []
  for (const scenario of scenarios) {
    const adjustments = await loadAdjustmentsForScenario(admin, scenario.id)
    result.push({
      scenario: {
        id: scenario.id,
        orgId: scenario.org_id,
        name: scenario.name,
        description: scenario.description,
        isDefault: scenario.is_default,
        createdBy: scenario.created_by,
        createdAt: scenario.created_at,
      },
      adjustments,
    })
  }
  return result
}

/**
 * Load adjustments for a single scenario.
 */
async function loadAdjustmentsForScenario(admin: AdminClient, scenarioId: string): Promise<PaymentAdjustment[]> {
  const rows = await fetchAllPages<AdjustmentRow>(
    (from, to) =>
      admin
        .from('scenario_adjustments')
        .select('ap_id, days_delta, percentage')
        .eq('scenario_id', scenarioId)
        .range(from, to),
    'Failed to load scenario_adjustments'
  )
  return rows.map((r) => ({ apId: r.ap_id, daysDelta: r.days_delta, percentage: r.percentage }))
}

/**
 * Save a planned payment date for an AP account.
 * Creates or updates the planned_date.
 */
export async function savePlannedPayment(orgId: string, apId: string, plannedDate: string, actorProfileId: string): Promise<void> {
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from('planned_payments').upsert(
    {
      org_id: orgId,
      ap_id: apId,
      planned_date: plannedDate,
      created_by: actorProfileId,
    },
    { onConflict: 'org_id,ap_id' }
  )
  if (error) throw new Error(`Failed to save planned_payment: ${error.message}`)
}

/**
 * Delete a planned payment.
 */
export async function deletePlannedPayment(orgId: string, apId: string): Promise<void> {
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from('planned_payments').delete().eq('org_id', orgId).eq('ap_id', apId)
  if (error) throw new Error(`Failed to delete planned_payment: ${error.message}`)
}

/**
 * Create a new payment scenario with adjustments.
 */
export async function createPaymentScenario(
  orgId: string,
  name: string,
  description: string | null,
  adjustments: Array<{ apId: string; daysDelta?: number; percentage?: number }>,
  actorProfileId: string
): Promise<PaymentScenario> {
  const admin = createAdminSupabaseClient()

  // Insert scenario
  const { data: scenario, error: scenarioError } = await admin
    .from('payment_scenarios')
    .insert({ org_id: orgId, name, description, created_by: actorProfileId })
    .select('id, org_id, name, description, is_default, created_by, created_at')
    .single()

  if (scenarioError) throw new Error(`Failed to create payment_scenario: ${scenarioError.message}`)

  // Insert adjustments
  if (adjustments.length > 0) {
    const { error: adjustError } = await admin.from('scenario_adjustments').insert(
      adjustments.map((a) => ({
        scenario_id: scenario.id,
        ap_id: a.apId,
        days_delta: a.daysDelta ?? 0,
        percentage: a.percentage ?? 100,
      }))
    )
    if (adjustError) throw new Error(`Failed to insert scenario_adjustments: ${adjustError.message}`)
  }

  return {
    id: scenario.id,
    orgId: scenario.org_id,
    name: scenario.name,
    description: scenario.description,
    isDefault: scenario.is_default,
    createdBy: scenario.created_by,
    createdAt: scenario.created_at,
  }
}

/**
 * Helper: Convert planned payments + optional scenario into AdjustedPayment array.
 * Used by the front-end to preview what-if scenarios.
 */
export function calculateAdjustedPayments(
  plannedPayments: PlannedPayment[],
  apDetails: Map<string, { value: number; dataVencimento: string }>,
  adjustments?: PaymentAdjustment[]
): AdjustedPayment[] {
  return plannedPayments
    .map((pp) => {
      const details = apDetails.get(pp.apId)
      if (!details) return null

      const payment: PlannedPaymentValue = {
        apId: pp.apId,
        value: details.value,
        dataVencimento: details.dataVencimento,
        plannedDate: pp.plannedDate,
      }

      const adjustment = adjustments?.find((a) => a.apId === pp.apId)
      return applyScenarioToPayment(payment, adjustment)
    })
    .filter(Boolean) as AdjustedPayment[]
}
