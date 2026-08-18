import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const uuid = () => crypto.randomUUID()

describe('POST /api/payments/planned', () => {
  let testOrgId: string
  let testProfileId: string
  let testApId: string

  beforeAll(async () => {
    testOrgId = uuid()
    testProfileId = uuid()
    testApId = uuid()

    const admin = createAdminSupabaseClient()

    await admin.from('organizations').insert({ id: testOrgId, name: 'Test Org' })

    await admin.from('profiles').insert({
      id: testProfileId,
      email: `test-${uuid()}@example.com`,
      name: 'Test User',
    })

    await admin.from('olist_organizations_members').insert({
      org_id: testOrgId,
      profile_id: testProfileId,
      role: 'admin',
    })

    await admin.from('olist_accounts_payable').insert({
      id: testApId,
      org_id: testOrgId,
      valor: 1000,
      data_vencimento: '2025-02-15',
      descricao_produto: 'Test Payment',
    })
  })

  afterAll(async () => {
    const admin = createAdminSupabaseClient()
    await admin.from('olist_accounts_payable').delete().eq('org_id', testOrgId)
    await admin.from('olist_organizations_members').delete().eq('org_id', testOrgId)
    await admin.from('profiles').delete().eq('id', testProfileId)
    await admin.from('organizations').delete().eq('id', testOrgId)
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

    const { data: upserted } = await admin
      .from('planned_payments')
      .upsert({
        org_id: testOrgId,
        ap_id: testApId,
        planned_date: plannedDate2,
        created_by: testProfileId,
      })
      .select()

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

  beforeAll(async () => {
    testOrgId = uuid()
    testProfileId = uuid()

    const admin = createAdminSupabaseClient()

    await admin.from('organizations').insert({ id: testOrgId, name: 'Test Org' })

    await admin.from('profiles').insert({
      id: testProfileId,
      email: `test-${uuid()}@example.com`,
      name: 'Test User',
    })

    await admin.from('olist_organizations_members').insert({
      org_id: testOrgId,
      profile_id: testProfileId,
      role: 'admin',
    })
  })

  afterAll(async () => {
    const admin = createAdminSupabaseClient()
    await admin.from('olist_organizations_members').delete().eq('org_id', testOrgId)
    await admin.from('profiles').delete().eq('id', testProfileId)
    await admin.from('organizations').delete().eq('id', testOrgId)
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
    const apId = uuid()

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
      ap_id: apId,
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
