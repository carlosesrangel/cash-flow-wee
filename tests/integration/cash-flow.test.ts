import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceKey)

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const FIXTURE_PREFIX = 'INTEGRATION-TEST-CASHFLOW'

async function cleanupFixtures(): Promise<void> {
  await admin.from('olist_accounts_receivable').delete().eq('org_id', ORG_ID).like('numero_documento', `${FIXTURE_PREFIX}%`)
  await admin.from('olist_accounts_payable').delete().eq('org_id', ORG_ID).like('numero_documento', `${FIXTURE_PREFIX}%`)
  await admin.from('manual_cash_entries').delete().eq('org_id', ORG_ID).like('description', `${FIXTURE_PREFIX}%`)
  await admin.from('cash_balance_snapshots').delete().eq('org_id', ORG_ID).like('notes', `${FIXTURE_PREFIX}%`)
}

async function seedProfileId(): Promise<string | null> {
  const { data } = await admin.from('organization_members').select('profile_id').eq('org_id', ORG_ID).limit(1).maybeSingle()
  return (data?.profile_id as string | undefined) ?? null
}

describe('cash flow engine — real database integration', () => {
  beforeEach(cleanupFixtures)
  afterEach(cleanupFixtures)

  it('classifies a real AR/AP pair, resolves an opening balance, and aggregates a consistent daily saldo', async () => {
    const profileId = await seedProfileId()
    if (!profileId) {
      // No local profile to attribute a snapshot/entry to on a fresh,
      // unseeded local instance — see the same accepted degradation pattern
      // in tests/integration/reconciliation.test.ts.
      return
    }

    await admin.from('cash_balance_snapshots').insert({
      org_id: ORG_ID,
      reference_date: '2026-08-01',
      bank_balance: 10000,
      notes: `${FIXTURE_PREFIX}-snapshot`,
      created_by: profileId,
    })

    await admin.from('olist_accounts_receivable').insert({
      org_id: ORG_ID,
      olist_id: 999999101,
      situacao: 'aberto',
      data_vencimento: '2026-08-10',
      valor: 500,
      saldo: 500,
      numero_documento: `${FIXTURE_PREFIX}/01`,
      raw: {},
    })

    await admin.from('olist_accounts_payable').insert({
      org_id: ORG_ID,
      olist_id: 999999102,
      situacao: 'aberto',
      data_vencimento: '2026-08-12',
      valor: 200,
      saldo: 200,
      numero_documento: `${FIXTURE_PREFIX}/02`,
      raw: {},
    })

    const { loadCashFlowEntries, resolveOpeningBalance } = await import('@/lib/cash-flow/engine')
    const { aggregateByDay } = await import('@/lib/cash-flow/aggregate')

    const entries = await loadCashFlowEntries(ORG_ID)
    const fixtureEntries = entries.filter((e) => e.sourceId && (e.description ?? '').startsWith(FIXTURE_PREFIX))
    expect(fixtureEntries).toHaveLength(2)

    const opening = await resolveOpeningBalance(ORG_ID, '2026-08-05')
    expect(opening).toEqual({ balance: 10000, asOf: '2026-08-01' })

    const days = aggregateByDay(entries, { from: '2026-08-05', to: '2026-08-15' }, opening)
    for (const day of days) {
      if (day.saldoInicial === null) continue
      expect(day.saldoFinal).toBe(
        day.saldoInicial + day.entradas.realizado + day.entradas.contratado - day.saidas.realizado - day.saidas.contratado
      )
    }
    const arDay = days.find((d) => d.date === '2026-08-10')
    const apDay = days.find((d) => d.date === '2026-08-12')
    expect(arDay?.entradas.contratado).toBeGreaterThanOrEqual(500)
    expect(apDay?.saidas.contratado).toBeGreaterThanOrEqual(200)
  })
})
