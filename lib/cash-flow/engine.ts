import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages, LINKED_STATUSES } from '@/lib/reconciliation/run'
import { classifyAccountsReceivable, classifyAccountsPayable, type CashBucket } from '@/lib/cash-flow/classify'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type CashFlowEntry = {
  id: string
  origin: 'ar' | 'ap' | 'manual' | 'forecast'
  sourceId: string
  date: string
  amount: number
  direction: 'entrada' | 'saida'
  bucket: CashBucket
  description: string | null
}

type ArRow = {
  id: string
  valor: number | null
  saldo: number | null
  situacao: string | null
  data_vencimento: string | null
  data_liquidacao: string | null
  historico: string | null
  numero_documento: string | null
}

const AR_COLUMNS = 'id, valor, saldo, situacao, data_vencimento, data_liquidacao, historico, numero_documento'

// PostgREST's generated types infer the `!inner`-joined relation as an array
// (it can't tell from the query alone that `sumup_transaction_event_id` is
// unique per match row), so the raw page shape allows both an array and a
// single object. The lookup below (`Array.isArray`) handles either shape.
type RawReconciledDateRow = {
  olist_accounts_receivable_id: string
  sumup_transaction_events: { due_date: string | null }[] | { due_date: string | null } | null
}

/**
 * Maps `olist_accounts_receivable_id` -> the linked SumUp event's `due_date`
 * for every resolved (`LINKED_STATUSES`) reconciliation match in the org.
 * Exported so the Contas a Receber page (Task 10) can reuse the same lookup
 * for display without duplicating this query.
 */
export async function loadReconciledCashDates(admin: AdminClient, orgId: string): Promise<Map<string, string>> {
  const rows = await fetchAllPages<RawReconciledDateRow>(
    (from, to) =>
      admin
        .from('reconciliation_matches')
        .select('olist_accounts_receivable_id, sumup_transaction_events!inner(due_date)')
        .eq('org_id', orgId)
        .in('status', LINKED_STATUSES)
        .not('sumup_transaction_event_id', 'is', null)
        .range(from, to) as unknown as PromiseLike<{ data: RawReconciledDateRow[] | null; error: { message: string } | null }>,
    'Failed to load reconciled cash dates'
  )

  const map = new Map<string, string>()
  for (const row of rows) {
    const related = row.sumup_transaction_events
    const dueDate = Array.isArray(related) ? related[0]?.due_date : related?.due_date
    if (dueDate) map.set(row.olist_accounts_receivable_id, dueDate)
  }
  return map
}

async function loadArEntries(admin: AdminClient, orgId: string): Promise<CashFlowEntry[]> {
  const rows = await fetchAllPages<ArRow>(
    (from, to) => admin.from('olist_accounts_receivable').select(AR_COLUMNS).eq('org_id', orgId).range(from, to),
    'Failed to load olist_accounts_receivable for cash flow'
  )
  const reconciledDates = await loadReconciledCashDates(admin, orgId)

  const entries: CashFlowEntry[] = []
  for (const row of rows) {
    const classified = classifyAccountsReceivable(row, reconciledDates.get(row.id) ?? null)
    if (!classified.included) continue
    entries.push({
      id: `ar-${row.id}`,
      origin: 'ar',
      sourceId: row.id,
      date: classified.date,
      amount: row.valor as number,
      direction: 'entrada',
      bucket: classified.bucket,
      description: row.numero_documento ?? row.historico,
    })
  }
  return entries
}

type ApRow = {
  id: string
  valor: number | null
  saldo: number | null
  situacao: string | null
  data_vencimento: string | null
  historico: string | null
  numero_documento: string | null
}

const AP_COLUMNS = 'id, valor, saldo, situacao, data_vencimento, historico, numero_documento'

async function loadApEntries(admin: AdminClient, orgId: string): Promise<CashFlowEntry[]> {
  const rows = await fetchAllPages<ApRow>(
    (from, to) => admin.from('olist_accounts_payable').select(AP_COLUMNS).eq('org_id', orgId).range(from, to),
    'Failed to load olist_accounts_payable for cash flow'
  )

  const entries: CashFlowEntry[] = []
  for (const row of rows) {
    const classified = classifyAccountsPayable(row)
    if (!classified.included) continue
    entries.push({
      id: `ap-${row.id}`,
      origin: 'ap',
      sourceId: row.id,
      date: classified.date,
      amount: row.valor as number,
      direction: 'saida',
      bucket: classified.bucket,
      description: row.numero_documento ?? row.historico,
    })
  }
  return entries
}

type ManualRow = {
  id: string
  type: 'entrada' | 'saida' | 'ajuste_saldo'
  amount: number
  entry_date: string
  description: string | null
}

async function loadManualEntries(admin: AdminClient, orgId: string): Promise<CashFlowEntry[]> {
  const rows = await fetchAllPages<ManualRow>(
    (from, to) =>
      admin
        .from('manual_cash_entries')
        .select('id, type, amount, entry_date, description')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .in('type', ['entrada', 'saida'])
        .range(from, to),
    'Failed to load manual_cash_entries for cash flow'
  )

  return rows.map((row) => ({
    id: `manual-${row.id}`,
    origin: 'manual' as const,
    sourceId: row.id,
    date: row.entry_date,
    amount: row.amount,
    direction: row.type === 'entrada' ? ('entrada' as const) : ('saida' as const),
    bucket: 'realizado' as const,
    description: row.description,
  }))
}

/**
 * Loads every classified cash flow entry (AR + AP + manual entrada/saida)
 * for the org, as a flat list. `ajuste_saldo` rows are deliberately excluded
 * here — they adjust the confirmed opening balance (`resolveOpeningBalance`
 * below), not the daily entrada/saida flow.
 */
export async function loadCashFlowEntries(orgId: string): Promise<CashFlowEntry[]> {
  const admin = createAdminSupabaseClient()
  const [ar, ap, manual] = await Promise.all([
    loadArEntries(admin, orgId),
    loadApEntries(admin, orgId),
    loadManualEntries(admin, orgId),
  ])
  return [...ar, ...ap, ...manual]
}

/**
 * Resolves the confirmed cash balance to use as the opening balance for
 * `date`: the most recent `cash_balance_snapshots` row strictly before
 * `date`, plus any `ajuste_saldo` manual entries dated strictly between that
 * snapshot and `date`, plus every `realizado`-bucket entry (already-settled
 * AR/AP and manual entrada/saida) from `entries` dated in that same gap —
 * those represent cash that actually moved after the snapshot was taken and
 * must be carried forward, otherwise the opening balance is off by exactly
 * whatever moved between the snapshot and `date`. `contratado` entries are
 * deliberately excluded: they are unrealized and would blend a projection
 * into a confirmed balance. Returns null when no snapshot exists yet — the
 * caller (`aggregateByDay`) must not fabricate a starting balance.
 *
 * When two snapshots share the same `reference_date` (the table has no
 * uniqueness constraint on it — re-recording the same day is the obvious
 * case), the most recently created one wins.
 */
export async function resolveOpeningBalance(
  orgId: string,
  date: string,
  entries: CashFlowEntry[]
): Promise<{ balance: number; asOf: string } | null> {
  const admin = createAdminSupabaseClient()

  const { data: snapshot, error: snapshotError } = await admin
    .from('cash_balance_snapshots')
    .select('reference_date, bank_balance, cash_on_hand, liquid_investments')
    .eq('org_id', orgId)
    .lt('reference_date', date)
    .order('reference_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (snapshotError) {
    throw new Error(`Failed to load cash_balance_snapshots: ${snapshotError.message}`)
  }
  if (!snapshot) return null

  const referenceDate = snapshot.reference_date as string
  const baseBalance =
    (snapshot.bank_balance as number) +
    ((snapshot.cash_on_hand as number | null) ?? 0) +
    ((snapshot.liquid_investments as number | null) ?? 0)

  const adjustments = await fetchAllPages<{ amount: number }>(
    (from, to) =>
      admin
        .from('manual_cash_entries')
        .select('amount')
        .eq('org_id', orgId)
        .eq('type', 'ajuste_saldo')
        .is('deleted_at', null)
        .gt('entry_date', referenceDate)
        .lt('entry_date', date)
        .range(from, to),
    'Failed to load ajuste_saldo entries'
  )

  const adjustmentTotal = adjustments.reduce((sum, row) => sum + row.amount, 0)

  // realizado entries (already-settled AR/AP + manual entrada/saida) dated in
  // the same gap represent cash that actually moved and must not be dropped
  // — only ajuste_saldo was being counted before, silently undercounting or
  // overcounting every page's opening balance by whatever moved in the gap.
  const realizadoSinceSnapshot = entries
    .filter((entry) => entry.bucket === 'realizado' && entry.date > referenceDate && entry.date < date)
    .reduce((sum, entry) => sum + (entry.direction === 'entrada' ? entry.amount : -entry.amount), 0)

  return { balance: baseBalance + adjustmentTotal + realizadoSinceSnapshot, asOf: referenceDate }
}
