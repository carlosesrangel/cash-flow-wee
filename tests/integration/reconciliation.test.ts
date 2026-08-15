import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// This suite MUTATES data (runReconciliation upserts/demotes rows for the whole
// org, the confirm route writes) using the service-role key, which bypasses
// RLS. Pointed at a shared or hosted project it would corrupt real
// reconciliation state, so refuse to run anywhere but a local Supabase.
const LOCAL_HOSTNAMES = ['127.0.0.1', 'localhost', '::1', '[::1]']
const hostname = (() => {
  try {
    return new URL(url ?? '').hostname
  } catch {
    return null
  }
})()
if (!hostname || !LOCAL_HOSTNAMES.includes(hostname)) {
  throw new Error(
    `Refusing to run the integration suite against a non-local Supabase (NEXT_PUBLIC_SUPABASE_URL host: ${hostname ?? '<unset/invalid>'}). ` +
      `Point .env.local at a local instance (npx supabase start) before running npm run test:integration.`
  )
}

const admin = createClient(url, serviceKey)

// Fixed local seed org — see supabase/seed.sql.
const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: null as string | null, role: 'OWNER_ADMIN' as const }

// Every fixture row this file creates carries this prefix in
// numero_documento / transaction_code, so cleanup can find them precisely
// without touching any other data a developer might have in their local
// instance.
const FIXTURE_PREFIX = 'INTEGRATION-TEST-RECONCILIACAO'

async function cleanupFixtures(): Promise<void> {
  const { data: arRows } = await admin
    .from('olist_accounts_receivable')
    .select('id')
    .eq('org_id', ORG_ID)
    .like('numero_documento', `${FIXTURE_PREFIX}%`)

  const arIds = (arRows ?? []).map((row) => row.id)
  if (arIds.length > 0) {
    await admin.from('reconciliation_matches').delete().in('olist_accounts_receivable_id', arIds)
    await admin.from('olist_accounts_receivable').delete().in('id', arIds)
  }

  const { data: txRows } = await admin
    .from('sumup_transactions')
    .select('id')
    .eq('org_id', ORG_ID)
    .like('transaction_code', `${FIXTURE_PREFIX}%`)

  const txIds = (txRows ?? []).map((row) => row.id)
  if (txIds.length > 0) {
    await admin.from('sumup_transaction_events').delete().in('transaction_id', txIds)
    await admin.from('sumup_transactions').delete().in('id', txIds)
  }
}

async function seedMember(): Promise<void> {
  // Reuse a real profile if one exists locally (e.g. from `supabase db reset`
  // + manual signup); otherwise these tests need a profile row to satisfy
  // reconciliation_matches.resolved_by's FK when the confirm route runs. Look
  // one up rather than creating an auth user here (out of scope for this
  // test — auth user creation is already covered by tests/unit/rls/).
  const { data } = await admin.from('organization_members').select('profile_id').eq('org_id', ORG_ID).limit(1).maybeSingle()
  MEMBER.profileId = (data?.profile_id as string | undefined) ?? null
}

describe('reconciliation engine — real database integration', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    await seedMember()
  })

  afterEach(async () => {
    await cleanupFixtures()
  })

  it('matches a card-paid installment against a SumUp PAYOUT event end-to-end, is idempotent, and survives a confirm', async () => {
    const { data: tx, error: txError } = await admin
      .from('sumup_transactions')
      .insert({
        org_id: ORG_ID,
        transaction_code: `${FIXTURE_PREFIX}-tx-1`,
        amount: 809.2,
        currency: 'BRL',
        status: 'SUCCESSFUL',
        installments_count: 1,
        raw: {},
      })
      .select('id')
      .single()
    if (txError || !tx) throw new Error(`fixture setup failed: ${txError?.message}`)

    const { error: eventError } = await admin.from('sumup_transaction_events').insert({
      org_id: ORG_ID,
      transaction_id: tx.id,
      event_type: 'PAYOUT',
      status: 'SUCCESSFUL',
      amount: 774.8,
      due_date: '2026-02-02',
      installment_number: 1,
      raw: {},
    })
    if (eventError) throw new Error(`fixture setup failed: ${eventError.message}`)

    const { data: ar, error: arError } = await admin
      .from('olist_accounts_receivable')
      .insert({
        org_id: ORG_ID,
        olist_id: 999999001,
        situacao: 'aberta',
        data_vencimento: '2026-02-01',
        valor: 809.2,
        numero_documento: `${FIXTURE_PREFIX}/01`,
        forma_recebimento_nome: 'Cartão de crédito',
        raw: {},
      })
      .select('id')
      .single()
    if (arError || !ar) throw new Error(`fixture setup failed: ${arError?.message}`)

    const { runReconciliation } = await import('@/lib/reconciliation')

    const first = await runReconciliation(ORG_ID)
    expect(first.processed).toBeGreaterThanOrEqual(1)

    const { data: matchAfterFirst } = await admin
      .from('reconciliation_matches')
      .select('id, status, sumup_transaction_event_id')
      .eq('org_id', ORG_ID)
      .eq('olist_accounts_receivable_id', ar.id)
      .single()

    expect(matchAfterFirst?.status).toBe('reconciliado_automaticamente')
    expect(matchAfterFirst?.sumup_transaction_event_id).toBeTruthy()

    // Idempotency: running again must not duplicate or change the row.
    const second = await runReconciliation(ORG_ID)
    const { data: matchAfterSecond, count } = await admin
      .from('reconciliation_matches')
      .select('id, status', { count: 'exact' })
      .eq('org_id', ORG_ID)
      .eq('olist_accounts_receivable_id', ar.id)

    expect(count).toBe(1)
    expect(matchAfterSecond?.[0]?.status).toBe('reconciliado_automaticamente')
    void second

    if (!MEMBER.profileId) {
      // No local profile to attribute a manual confirm to — the matching
      // half of this test above is still real signal; skip only the
      // confirm-route portion rather than failing the whole suite on a
      // fresh, unseeded local instance.
      return
    }

    const { getCurrentMember } = await import('@/lib/auth/session')
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)

    // Manufacture a real conflict to exercise the confirm route meaningfully:
    // force this match back to conflito with the real event as its sole
    // candidate, then confirm it.
    await admin
      .from('reconciliation_matches')
      .update({ status: 'conflito', candidate_ids: [matchAfterFirst!.sumup_transaction_event_id] })
      .eq('id', matchAfterFirst!.id)

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(
      new Request('http://localhost/api/reconciliacao/x/confirmar', {
        method: 'POST',
        body: JSON.stringify({ sumupTransactionEventId: matchAfterFirst!.sumup_transaction_event_id }),
      }),
      { params: Promise.resolve({ id: matchAfterFirst!.id }) }
    )
    expect(response.status).toBe(200)

    const { data: matchAfterConfirm } = await admin
      .from('reconciliation_matches')
      .select('status, resolved_by')
      .eq('id', matchAfterFirst!.id)
      .single()
    expect(matchAfterConfirm?.status).toBe('reconciliado_manualmente')
    expect(matchAfterConfirm?.resolved_by).toBe(MEMBER.profileId)
  })
})
