import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { applyScenarioToPayment } from '@/lib/payments/scenarios'
import type { PaymentAdjustment, PlannedPaymentValue, AdjustedPayment } from '@/lib/payments/scenarios'
import { classifyPayableStatus, type PayableStatusResult } from '@/lib/payables/classify-status'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type PlannedPayment = {
  apId: string
  plannedDate: string
  createdBy: string | null
  createdAt: string
}

export type PayableCandidate = {
  apId: string
  fornecedorNome: string | null
  categoria: string | null
  dataVencimento: string | null
  saldo: number
  plannedDate: string | null
  payableStatus: PayableStatusResult
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

/** Load only outstanding payables that can be selected for payment planning. */
export async function loadPayableCandidates(orgId: string): Promise<PayableCandidate[]> {
  const admin = createAdminSupabaseClient()
  const [{ data: rows, error }, { data: contacts, error: contactsError }, { data: planned, error: plannedError }] = await Promise.all([
    admin.from('olist_accounts_payable').select('id, fornecedor_olist_id, categoria, data_vencimento, saldo, valor, situacao, data_liquidacao').eq('org_id', orgId).order('data_vencimento', { ascending: true }),
    admin.from('olist_contacts').select('olist_id, nome').eq('org_id', orgId),
    admin.from('planned_payments').select('ap_id, planned_date').eq('org_id', orgId),
  ])
  if (error) throw new Error(`Failed to load payable candidates: ${error.message}`)
  if (contactsError) throw new Error(`Failed to load payable suppliers: ${contactsError.message}`)
  if (plannedError) throw new Error(`Failed to load planned dates: ${plannedError.message}`)

  const contactNames = new Map((contacts ?? []).map((contact) => [contact.olist_id as number, contact.nome as string | null]))
  const plannedDates = new Map((planned ?? []).map((payment) => [payment.ap_id as string, payment.planned_date as string]))

  return (rows ?? []).flatMap((row) => {
    const status = classifyPayableStatus(row.situacao, row.saldo, row.valor, row.data_vencimento, row.data_liquidacao)
    const parsedBalance = Number(row.saldo)
    const balance = row.saldo !== null && row.saldo !== undefined && Number.isFinite(parsedBalance) ? parsedBalance : null
    if (balance === null || balance <= 0 || status.status === 'paid' || status.status === 'cancelled') return []
    return [{
      apId: row.id as string,
      fornecedorNome: row.fornecedor_olist_id ? contactNames.get(row.fornecedor_olist_id as number) ?? null : null,
      categoria: row.categoria as string | null,
      dataVencimento: row.data_vencimento as string | null,
      saldo: balance,
      plannedDate: plannedDates.get(row.id as string) ?? row.data_vencimento as string | null,
      payableStatus: status,
    }]
  })
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
        .select('scenario_id, ap_id, days_delta, percentage')
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

export async function savePlannedPayments(orgId: string, payments: Array<{ apId: string; plannedDate: string }>, actorProfileId: string): Promise<void> {
  if (payments.length === 0) return
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from('planned_payments').upsert(
    payments.map((payment) => ({ org_id: orgId, ap_id: payment.apId, planned_date: payment.plannedDate, created_by: actorProfileId })),
    { onConflict: 'org_id,ap_id' }
  )
  if (error) throw new Error(`Failed to save planned_payments: ${error.message}`)
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
