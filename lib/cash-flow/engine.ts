import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages, LINKED_STATUSES } from '@/lib/reconciliation/run'
import { classifyAccountsReceivable, classifyAccountsPayable, type CashBucket } from '@/lib/cash-flow/classify'
import { aggregateByDay, type CashFlowDay } from '@/lib/cash-flow/aggregate'
import { shiftDateString } from '@/lib/cash-flow/dates'

export type { CashBucket } from '@/lib/cash-flow/classify'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type CashFlowEntry = {
  id: string
  origin: 'ar' | 'ap' | 'manual' | 'forecast' | 'payment_plan' | 'ledger'
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
  data_emissao: string | null
  historico: string | null
  numero_documento: string | null
  cliente_olist_id: number | null
}

const AR_COLUMNS =
  'id, valor, saldo, situacao, data_vencimento, data_liquidacao, data_emissao, historico, numero_documento, cliente_olist_id'

/** Extracts "4/5" style installment markers Olist embeds in `historico` (e.g. "... (parcela 4/5)"). */
function parseParcela(historico: string | null): string | null {
  if (!historico) return null
  const match = historico.match(/parcela\s+(\d+)\/(\d+)/i)
  return match ? `${match[1]}/${match[2]}` : null
}

type OrderForProduct = { id: string; cliente_olist_id: number | null; data: string | null }

const PRODUCT_MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

type ClientOrderProducts = { date: string; products: string }

/**
 * Builds a `cliente_olist_id -> [{date, products}]` lookup so AR entries can
 * show the product(s) that generated them. Olist's contas-a-receber
 * endpoint has no direct FK to the order/invoice that created it —
 * `numero_documento`'s NF number doesn't match `olist_orders.id_nota_fiscal`
 * (a different internal id) — so the match is by client + closest order
 * date within `PRODUCT_MATCH_WINDOW_MS` of the receivable's emission date,
 * the closest signal available (an invoice is typically issued within a few
 * days of the order). ~50% of this org's AR rows resolve a match this way;
 * the rest show client + parcela only rather than a guessed product.
 */
async function loadProductsByClientAndDate(
  admin: AdminClient,
  orgId: string
): Promise<Map<number, ClientOrderProducts[]>> {
  const [orders, items] = await Promise.all([
    fetchAllPages<OrderForProduct>(
      (from, to) =>
        admin.from('olist_orders').select('id, cliente_olist_id, data').eq('org_id', orgId).range(from, to),
      'Failed to load olist_orders for cash flow product lookup'
    ),
    fetchAllPages<{ order_id: string; descricao_produto: string | null }>(
      (from, to) =>
        admin.from('olist_order_items').select('order_id, descricao_produto').eq('org_id', orgId).range(from, to),
      'Failed to load olist_order_items for cash flow product lookup'
    ),
  ])

  const productsByOrderId = new Map<string, string[]>()
  for (const item of items) {
    if (!item.descricao_produto) continue
    const list = productsByOrderId.get(item.order_id) ?? []
    list.push(item.descricao_produto)
    productsByOrderId.set(item.order_id, list)
  }

  const map = new Map<number, ClientOrderProducts[]>()
  for (const order of orders) {
    if (!order.cliente_olist_id || !order.data) continue
    const products = productsByOrderId.get(order.id)
    if (!products || products.length === 0) continue
    const list = map.get(order.cliente_olist_id) ?? []
    list.push({ date: order.data, products: products.join(', ') })
    map.set(order.cliente_olist_id, list)
  }
  return map
}

function findClosestProduct(
  candidates: ClientOrderProducts[] | undefined,
  targetDate: string
): string | null {
  if (!candidates || candidates.length === 0) return null
  const targetMs = new Date(targetDate).getTime()
  let best: { diff: number; products: string } | null = null
  for (const candidate of candidates) {
    const diff = Math.abs(new Date(candidate.date).getTime() - targetMs)
    if (diff > PRODUCT_MATCH_WINDOW_MS) continue
    if (!best || diff < best.diff) best = { diff, products: candidate.products }
  }
  return best?.products ?? null
}

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
  const [reconciledDates, contacts, productsByClientAndDate] = await Promise.all([
    loadReconciledCashDates(admin, orgId),
    fetchAllPages<{ olist_id: number; nome: string | null }>(
      (from, to) => admin.from('olist_contacts').select('olist_id, nome').eq('org_id', orgId).range(from, to),
      'Failed to load olist_contacts for cash flow'
    ),
    loadProductsByClientAndDate(admin, orgId),
  ])
  const nameByClientId = new Map(contacts.map((c) => [c.olist_id, c.nome]))

  const entries: CashFlowEntry[] = []
  for (const row of rows) {
    const classified = classifyAccountsReceivable(row, reconciledDates.get(row.id) ?? null)
    if (!classified.included) continue

    const clienteNome = row.cliente_olist_id ? nameByClientId.get(row.cliente_olist_id) : null
    const produto = row.cliente_olist_id && row.data_emissao
      ? findClosestProduct(productsByClientAndDate.get(row.cliente_olist_id), row.data_emissao)
      : null
    const parcela = parseParcela(row.historico)

    const parts = [
      clienteNome ? `Cliente: ${clienteNome}` : null,
      produto ? `Produto: ${produto}` : null,
      parcela ? `Parcela ${parcela}` : null,
    ].filter(Boolean)

    entries.push({
      id: `ar-${row.id}`,
      origin: 'ar',
      sourceId: row.id,
      date: classified.date,
      amount: row.valor as number,
      direction: 'entrada',
      bucket: classified.bucket,
      description: parts.length > 0 ? parts.join(' · ') : (row.numero_documento || row.historico),
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
  fornecedor_olist_id: number | null
}

const AP_COLUMNS = 'id, valor, saldo, situacao, data_vencimento, historico, numero_documento, fornecedor_olist_id'

async function loadApEntries(admin: AdminClient, orgId: string): Promise<CashFlowEntry[]> {
  const rows = await fetchAllPages<ApRow>(
    (from, to) => admin.from('olist_accounts_payable').select(AP_COLUMNS).eq('org_id', orgId).range(from, to),
    'Failed to load olist_accounts_payable for cash flow'
  )
  const contacts = await fetchAllPages<{ olist_id: number; nome: string | null }>(
    (from, to) => admin.from('olist_contacts').select('olist_id, nome').eq('org_id', orgId).range(from, to),
    'Failed to load olist_contacts for cash flow'
  )
  const nameByFornecedorId = new Map(contacts.map((c) => [c.olist_id, c.nome]))

  const entries: CashFlowEntry[] = []
  for (const row of rows) {
    const classified = classifyAccountsPayable(row)
    if (!classified.included) continue

    // Olist returns numero_documento as '' (not null) when a payable has no
    // formal document — `??` only catches null/undefined, so the previous
    // code silently picked the empty string over the real historico text,
    // showing a blank description for most manually-entered AP rows.
    const historico = row.historico?.trim() || null
    const fornecedorNome = row.fornecedor_olist_id ? nameByFornecedorId.get(row.fornecedor_olist_id) : null
    const documento = row.numero_documento?.trim() || null

    const parts = [
      fornecedorNome ? `Fornecedor: ${fornecedorNome}` : null,
      historico,
      documento && documento !== historico ? `Doc: ${documento}` : null,
    ].filter(Boolean)

    entries.push({
      id: `ap-${row.id}`,
      origin: 'ap',
      sourceId: row.id,
      date: classified.date,
      amount: row.valor as number,
      direction: 'saida',
      bucket: classified.bucket,
      description: parts.length > 0 ? parts.join(' · ') : null,
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

/**
 * Builds the day-by-day cash flow for `[from, to]`, correctly handling the
 * common case where the org's only (or most recent) balance snapshot falls
 * *inside* that window instead of before it.
 *
 * `resolveOpeningBalance(orgId, from, entries)` only ever finds a snapshot
 * strictly before `from` — that's the right contract for "what was the
 * balance entering this date" (see its own tests), but every page that
 * renders a curve calls it once, anchored at `from`. A user registering
 * *today's* balance on a 90-day-lookback page (`from` = today − 90) will
 * never satisfy `reference_date < from`, so `aggregateByDay` gets a null
 * opening for the entire range and the curve stays empty — even though a
 * real snapshot now exists, just later in the window than `from`. That's
 * the bug behind "registrar o saldo não gera a curva".
 *
 * This stitches two `aggregateByDay` passes together: an unpriced segment
 * before the snapshot (same "no confirmed balance yet" look the chart
 * already had) and a priced segment from the day after the snapshot's
 * `reference_date` onward — the first date `resolveOpeningBalance` can
 * legitimately price.
 */
export async function buildCashFlowDays(
  orgId: string,
  from: string,
  to: string,
  entries: CashFlowEntry[]
): Promise<CashFlowDay[]> {
  const opening = await resolveOpeningBalance(orgId, from, entries)
  if (opening) {
    return aggregateByDay(entries, { from, to }, opening)
  }

  const admin = createAdminSupabaseClient()
  const { data: snapshot, error: snapshotError } = await admin
    .from('cash_balance_snapshots')
    .select('reference_date')
    .eq('org_id', orgId)
    .gte('reference_date', from)
    .lte('reference_date', to)
    .order('reference_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (snapshotError) {
    throw new Error(`Failed to load cash_balance_snapshots: ${snapshotError.message}`)
  }
  if (!snapshot) {
    return aggregateByDay(entries, { from, to }, null)
  }

  const balanceStartDate = shiftDateString(snapshot.reference_date as string, 1)
  if (balanceStartDate > to) {
    // The snapshot's reference_date is the last visible day — there is no
    // date left in range for which resolveOpeningBalance can price anything.
    return aggregateByDay(entries, { from, to }, null)
  }

  const before = aggregateByDay(entries, { from, to: shiftDateString(balanceStartDate, -1) }, null)
  const openingAtStart = await resolveOpeningBalance(orgId, balanceStartDate, entries)
  const after = aggregateByDay(entries, { from: balanceStartDate, to }, openingAtStart)

  return [...before, ...after]
}
