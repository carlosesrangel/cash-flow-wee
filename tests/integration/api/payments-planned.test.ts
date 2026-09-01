import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const uuid = () => crypto.randomUUID()

async function createTestUser(admin: ReturnType<typeof createAdminSupabaseClient>) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `integration-${uuid()}@example.com`,
    password: `${uuid()}Aa1!`,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('Failed to create local integration user')
  return data.user.id
}

async function assertDatabaseResult(result: PromiseLike<{ error: { message: string } | null }>) {
  const resolved = await result
  if (resolved.error) throw new Error(resolved.error.message)
}

describe('POST /api/payments/planned', () => {
  let testOrgId: string
  let testProfileId: string
  let testApId: string

  beforeAll(async () => {
    testOrgId = uuid()
    testApId = uuid()

    const admin = createAdminSupabaseClient()
    testProfileId = await createTestUser(admin)

    await assertDatabaseResult(admin.from('organizations').insert({ id: testOrgId, name: 'Test Org' }))

    await assertDatabaseResult(admin.from('organization_members').insert({
      org_id: testOrgId,
      profile_id: testProfileId,
      role: 'OWNER_ADMIN',
    }))

    await assertDatabaseResult(admin.from('olist_accounts_payable').insert({
      id: testApId,
      olist_id: Number.parseInt(testApId.replaceAll('-', '').slice(0, 8), 16),
      org_id: testOrgId,
      valor: 1000,
      data_vencimento: '2025-02-15',
      historico: 'Test Payment',
      saldo: 1000,
      raw: {},
    }))
  })

  afterAll(async () => {
    const admin = createAdminSupabaseClient()
    await admin.from('olist_accounts_payable').delete().eq('org_id', testOrgId)
    await admin.from('organization_members').delete().eq('org_id', testOrgId)
    await admin.from('organizations').delete().eq('id', testOrgId)
    await admin.auth.admin.deleteUser(testProfileId)
  })

  it('should save a planned payment', async () => {
    const admin = createAdminSupabaseClient()

    const plannedDate = '2025-02-10'

    const { data: inserted } = await admin
      .from('planned_payments')
      .insert({
        org_id: testOrgId,
        ap_id: testApId,
        planned_date: plannedDate,
        created_by: testProfileId,
      })
      .select()

    expect(inserted).toHaveLength(1)
    expect(inserted?.[0]?.org_id).toBe(testOrgId)
    expect(inserted?.[0]?.ap_id).toBe(testApId)
    expect(inserted?.[0]?.planned_date).toBe(plannedDate)
  })

  it('should upsert planned payment (update if exists)', async () => {
    const admin = createAdminSupabaseClient()

    const plannedDate1 = '2025-02-10'
    const plannedDate2 = '2025-02-12'

    await admin.from('planned_payments').delete().eq('ap_id', testApId)

    await admin.from('planned_payments').insert({
      org_id: testOrgId,
      ap_id: testApId,
      planned_date: plannedDate1,
      created_by: testProfileId,
    })

    const { data: upserted, error: upsertError } = await admin
      .from('planned_payments')
      .upsert({
        org_id: testOrgId,
        ap_id: testApId,
        planned_date: plannedDate2,
        created_by: testProfileId,
      }, { onConflict: 'org_id,ap_id' })
      .select()

    if (upsertError) throw new Error(upsertError.message)
    expect(upserted).toHaveLength(1)
    expect(upserted?.[0]?.planned_date).toBe(plannedDate2)
  })

  it('should delete planned payment', async () => {
    const admin = createAdminSupabaseClient()

    await admin.from('planned_payments').insert({
      org_id: testOrgId,
      ap_id: testApId,
      planned_date: '2025-02-10',
      created_by: testProfileId,
    })

    await admin.from('planned_payments').delete().eq('ap_id', testApId).eq('org_id', testOrgId)

    const { data: deleted } = await admin
      .from('planned_payments')
      .select()
      .eq('ap_id', testApId)
      .eq('org_id', testOrgId)

    expect(deleted).toHaveLength(0)
  })
})

describe('POST /api/payments/scenarios', () => {
  let testOrgId: string
  let testProfileId: string
  let testApId: string

  beforeAll(async () => {
    testOrgId = uuid()
    testApId = uuid()
    const admin = createAdminSupabaseClient()
    testProfileId = await createTestUser(admin)

    await assertDatabaseResult(admin.from('organizations').insert({ id: testOrgId, name: 'Test Org' }))
    await assertDatabaseResult(admin.from('organization_members').insert({
      org_id: testOrgId,
      profile_id: testProfileId,
      role: 'OWNER_ADMIN',
    }))
    await assertDatabaseResult(admin.from('olist_accounts_payable').insert({ id: testApId, olist_id: Number.parseInt(testApId.replaceAll('-', '').slice(0, 8), 16), org_id: testOrgId, valor: 1000, saldo: 1000, raw: {} }))
  })

  afterAll(async () => {
    const admin = createAdminSupabaseClient()
    await admin.from('organization_members').delete().eq('org_id', testOrgId)
    await admin.from('organizations').delete().eq('id', testOrgId)
    await admin.auth.admin.deleteUser(testProfileId)
  })

  it('should create a payment scenario', async () => {
    const admin = createAdminSupabaseClient()

    const { data: inserted } = await admin
      .from('payment_scenarios')
      .insert({
        org_id: testOrgId,
        name: 'Delayed by 30 days',
        description: 'Payment delayed 30 days',
        is_default: false,
        created_by: testProfileId,
      })
      .select()

    expect(inserted).toHaveLength(1)
    expect(inserted?.[0]?.name).toBe('Delayed by 30 days')
    expect(inserted?.[0]?.is_default).toBe(false)
  })

  it('should create scenario with adjustments', async () => {
    const admin = createAdminSupabaseClient()
    const { data: scenarios } = await admin
      .from('payment_scenarios')
      .insert({
        org_id: testOrgId,
        name: 'Test with adjustments',
        created_by: testProfileId,
      })
      .select()

    const scenarioId = scenarios?.[0]?.id

    await admin.from('scenario_adjustments').insert({
      scenario_id: scenarioId,
      ap_id: testApId,
      days_delta: 30,
      percentage: 80,
    })

    const { data: adjustments } = await admin
      .from('scenario_adjustments')
      .select()
      .eq('scenario_id', scenarioId)

    expect(adjustments).toHaveLength(1)
    expect(adjustments?.[0]?.days_delta).toBe(30)
    expect(adjustments?.[0]?.percentage).toBe(80)
  })
})
