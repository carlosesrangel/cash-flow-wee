import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  parseInstallmentNumber,
  computeGrossEstimate,
  withinAmountTolerance,
  withinDateWindow,
  classifyCandidates,
  CARD_PAYMENT_METHODS,
  type MatchCandidate,
} from '@/lib/reconciliation/match'

// Statuses that hold (or should hold) a real SumUp FK — eligible for the
// FK-repair pass and the duplicate-event-claim guard. Does NOT include
// 'rejeitado_manualmente': a rejected row's FK is intentionally null and
// must never be repaired or considered a claim.
// Exported so the manual-confirm route can reject a write that would create
// exactly the duplicate this guard exists to resolve (see
// app/api/reconciliacao/[id]/confirmar/route.ts) — one definition, one meaning.
export const LINKED_STATUSES = ['reconciliado_automaticamente', 'reconciliado_manualmente']

// Statuses that must never re-enter the matching engine's candidate pool —
// broader than LINKED_STATUSES because it also covers the durable "no"
// (rejeitado_manualmente).
const RESOLVED_STATUSES = ['reconciliado_automaticamente', 'reconciliado_manualmente', 'rejeitado_manualmente']
const DATE_WINDOW_DAYS = 5
/**
 * Supabase's hosted PostgREST caps a single response (commonly 1000 rows), so
 * every read below is paginated. Silently truncating the resolved-ids set
 * would let the main loop upsert over a manually-resolved row.
 */
const PAGE_SIZE = 500

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

type AccountsReceivableRow = {
  id: string
  valor: number | null
  data_vencimento: string | null
  numero_documento: string | null
  forma_recebimento_nome: string | null
}

type SumupEventCandidateRow = {
  id: string
  due_date: string | null
  installment_number: number | null
  sumup_transactions: {
    id: string
    amount: number | null
    installments_count: number | null
    status: string | null
  } | null
}

const AR_COLUMNS = 'id, valor, data_vencimento, numero_documento, forma_recebimento_nome'

/**
 * Shifts a bare SQL `date` string (YYYY-MM-DD) by `days`, treating it purely
 * as a calendar date. All arithmetic happens in UTC and the result is
 * re-serialized as a calendar day, so the answer never depends on the host
 * machine's timezone. Do NOT route these values through `toLocalDateParam`:
 * that helper converts a real wall-clock `Date` into a São Paulo calendar
 * day, which shifts a UTC-midnight-parsed bare date back by one day and
 * silently narrowed this window to -5/+4 days.
 */
function shiftDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null }

/**
 * Drains a paginated PostgREST read, calling `page(from, to)` until a page
 * comes back shorter than `PAGE_SIZE`.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  errorLabel: string
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) {
      throw new Error(`${errorLabel}: ${error.message}`)
    }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return rows
}

/**
 * Runs the matching engine over every card-paid AR installment that doesn't
 * already have a resolved (auto or manual) `reconciliation_matches` row, then
 * repairs already-resolved rows whose SumUp FKs were nulled out by a SumUp
 * resync.
 * Idempotent: re-running never touches a row already resolved, and upserts
 * (rather than inserts) everything else — see the unique constraint on
 * `(org_id, olist_accounts_receivable_id)`.
 */
export async function runReconciliation(orgId: string): Promise<{ processed: number }> {
  const admin = createAdminSupabaseClient()
  // `processed` counts only newly-matched (previously unresolved) AR rows;
  // repair-pass re-links are deliberately excluded since they don't re-decide
  // a match, they only restore a broken FK on an already-counted row.
  let processed = 0

  const resolvedRows = await fetchAllPages<{ olist_accounts_receivable_id: string }>(
    (from, to) =>
      admin
        .from('reconciliation_matches')
        .select('olist_accounts_receivable_id')
        .eq('org_id', orgId)
        .in('status', RESOLVED_STATUSES)
        .range(from, to),
    'Failed to load resolved reconciliation_matches'
  )

  const resolvedIds = new Set(resolvedRows.map((row) => row.olist_accounts_receivable_id))

  const allArRows = await fetchAllPages<AccountsReceivableRow>(
    (from, to) =>
      admin
        .from('olist_accounts_receivable')
        .select(AR_COLUMNS)
        .eq('org_id', orgId)
        .in('forma_recebimento_nome', CARD_PAYMENT_METHODS)
        .range(from, to),
    'Failed to load olist_accounts_receivable candidates'
  )

  // Exclusion is applied client-side rather than via `.not('id','in',(...))`:
  // embedding every resolved UUID in the request URL blows the URL-length
  // limit long before the row cap is reached.
  const arRows = allArRows.filter((row) => !resolvedIds.has(row.id))

  for (const ar of arRows) {
    processed += 1

    const result = await matchOne(admin, orgId, ar)

    const sumupTransactionId = result.status === 'reconciliado_automaticamente' ? result.sumupTransactionId : null
    const sumupTransactionEventId =
      result.status === 'reconciliado_automaticamente' ? result.sumupTransactionEventId : null
    const candidateIds = result.status === 'conflito' ? result.candidateIds : []

    const { error: upsertError } = await admin.from('reconciliation_matches').upsert(
      {
        org_id: orgId,
        olist_accounts_receivable_id: ar.id,
        sumup_transaction_id: sumupTransactionId,
        sumup_transaction_event_id: sumupTransactionEventId,
        status: result.status,
        match_reason: result.matchReason,
        candidate_ids: candidateIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )

    if (upsertError) {
      throw new Error(`Failed to upsert reconciliation_matches for ${ar.id}: ${upsertError.message}`)
    }
  }

  await repairStrandedMatches(admin, orgId)
  await guardAgainstDuplicateEventClaims(admin, orgId)

  return { processed }
}

/**
 * The SumUp transactions sync deletes and re-inserts every
 * `sumup_transaction_events` row for a transaction on each run (migration
 * 0010 — there is no natural key, so every event gets a fresh id). Both FK
 * columns on `reconciliation_matches` are `on delete set null`, so an
 * `initial`-mode resync strands every already-resolved row: `status` stays
 * resolved while both links go null. The main loop above never revisits those
 * rows (they're in `resolvedIds`), so they are re-linked here.
 *
 * Only an unambiguous single candidate re-links. 0 or >1 candidates leave the
 * row stranded for a future run — never demoted, never silently reassigned,
 * because the original resolution may have been a manual decision.
 */
async function repairStrandedMatches(admin: AdminClient, orgId: string): Promise<void> {
  const strandedRows = await fetchAllPages<{ id: string; olist_accounts_receivable_id: string }>(
    (from, to) =>
      admin
        .from('reconciliation_matches')
        .select('id, olist_accounts_receivable_id')
        .eq('org_id', orgId)
        .in('status', LINKED_STATUSES)
        .is('sumup_transaction_event_id', null)
        .range(from, to),
    'Failed to load stranded reconciliation_matches'
  )

  for (const stranded of strandedRows) {
    const { data: arRow, error: arError } = await admin
      .from('olist_accounts_receivable')
      .select(AR_COLUMNS)
      .eq('org_id', orgId)
      .eq('id', stranded.olist_accounts_receivable_id)
      .maybeSingle()

    if (arError) {
      throw new Error(`Failed to load olist_accounts_receivable ${stranded.olist_accounts_receivable_id}: ${arError.message}`)
    }
    if (!arRow) continue

    const result = await matchOne(admin, orgId, arRow as AccountsReceivableRow)
    if (result.status !== 'reconciliado_automaticamente') continue

    // Re-link only: `status`, `resolved_by` and `resolved_at` are left as-is,
    // since this row was already resolved (possibly manually).
    const { error: updateError } = await admin
      .from('reconciliation_matches')
      .update({
        sumup_transaction_id: result.sumupTransactionId,
        sumup_transaction_event_id: result.sumupTransactionEventId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', stranded.id)

    if (updateError) {
      throw new Error(`Failed to re-link reconciliation_matches ${stranded.id}: ${updateError.message}`)
    }
  }
}

/**
 * Two AR installments can end up claiming the same SumUp event across
 * separate runs (e.g. a repair-pass re-link happens to pick the same event
 * another row already holds). This is exactly the double-count the phase
 * exists to prevent, so after every run, any event claimed by more than one
 * `LINKED_STATUSES` row gets down to one legitimate claimant: prefer a
 * manual resolution over an automatic one (a human decision outranks the
 * engine's guess); among a tie, the earliest-created row wins. Every other
 * claimant in the group is demoted to `conflito`, cleared of its FK and
 * resolution fields, so a human can review it.
 */
async function guardAgainstDuplicateEventClaims(admin: AdminClient, orgId: string): Promise<void> {
  const linkedRows = await fetchAllPages<{
    id: string
    sumup_transaction_event_id: string
    status: string
    created_at: string
  }>(
    (from, to) =>
      admin
        .from('reconciliation_matches')
        .select('id, sumup_transaction_event_id, status, created_at')
        .eq('org_id', orgId)
        .in('status', LINKED_STATUSES)
        .not('sumup_transaction_event_id', 'is', null)
        .range(from, to),
    'Failed to load linked reconciliation_matches for duplicate-claim check'
  )

  const byEvent = new Map<string, typeof linkedRows>()
  for (const row of linkedRows) {
    const group = byEvent.get(row.sumup_transaction_event_id) ?? []
    group.push(row)
    byEvent.set(row.sumup_transaction_event_id, group)
  }

  for (const [eventId, group] of byEvent.entries()) {
    if (group.length < 2) continue

    // Fetched once per duplicated group (not per demoted row, and not joined
    // into the read above): demotions are rare, so paying one extra query per
    // affected event is far cheaper than embedding the event + transaction of
    // every linked row in the org just to use it in this branch.
    const candidatos = await loadCandidateDetail(admin, orgId, eventId)

    const manual = group.filter((row) => row.status === 'reconciliado_manualmente')
    const contenders = manual.length > 0 ? manual : group
    const winner = contenders.reduce((earliest, row) =>
      row.created_at < earliest.created_at ? row : earliest
    )

    for (const row of group) {
      if (row.id === winner.id) continue

      const { error } = await admin
        .from('reconciliation_matches')
        .update({
          status: 'conflito',
          sumup_transaction_id: null,
          sumup_transaction_event_id: null,
          resolved_by: null,
          resolved_at: null,
          match_reason: {
            motivo: 'evento_sumup_reivindicado_por_outra_parcela',
            // Same shape `classifyCandidates` emits for a `conflito`, so the
            // table's `candidateLabel` helper can render an amount/date instead
            // of falling back to a raw event-id fragment. Omitted entirely when
            // the detail can't be resolved — the UI degrades to the id.
            ...(candidatos.length > 0 ? { candidatos } : {}),
          },
          candidate_ids: [row.sumup_transaction_event_id],
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      if (error) {
        throw new Error(`Failed to demote duplicate-claim reconciliation_matches ${row.id}: ${error.message}`)
      }
    }
  }
}

/**
 * Resolves the amount/date detail of a single SumUp event, shaped exactly like
 * the `candidatos` entries `classifyCandidates` puts on a `conflito`'s
 * `match_reason`. The gross estimate goes through the shared
 * `computeGrossEstimate` so a demoted row shows the same number the engine
 * compared against in the first place.
 *
 * Returns an empty array (never throws) when the event, its transaction, or
 * any of the fields needed are missing: a missing label must not fail a whole
 * reconciliation run.
 */
async function loadCandidateDetail(
  admin: AdminClient,
  orgId: string,
  eventId: string
): Promise<Array<{ sumupTransactionEventId: string; valorBrutoSumupEstimado: number; dataVencimentoSumup: string }>> {
  const { data, error } = await admin
    .from('sumup_transaction_events')
    .select('id, due_date, sumup_transactions!inner(amount, installments_count)')
    .eq('org_id', orgId)
    .eq('id', eventId)
    .maybeSingle()

  if (error || !data) return []

  const row = data as unknown as {
    id: string
    due_date: string | null
    sumup_transactions: { amount: number | null; installments_count: number | null } | null
  }
  const transaction = row.sumup_transactions
  if (!row.due_date || !transaction || transaction.amount === null || !transaction.installments_count) return []

  const grossEstimate = computeGrossEstimate(transaction.amount, transaction.installments_count)
  if (grossEstimate === null) return []

  return [
    {
      sumupTransactionEventId: row.id,
      valorBrutoSumupEstimado: grossEstimate,
      dataVencimentoSumup: row.due_date,
    },
  ]
}

async function matchOne(admin: AdminClient, orgId: string, ar: AccountsReceivableRow) {
  if (!ar.valor || !ar.data_vencimento) {
    return { status: 'nao_reconciliado' as const, matchReason: { motivo: 'valor_ou_vencimento_ausente' } }
  }

  const installmentNumber = parseInstallmentNumber(ar.numero_documento)
  if (installmentNumber === null) {
    return { status: 'nao_reconciliado' as const, matchReason: { motivo: 'numero_parcela_nao_identificado' } }
  }

  // `data_vencimento` and `due_date` are both bare SQL `date` columns, so the
  // ±5-day window is pure calendar-date arithmetic (see `shiftDateString`).
  // The bounds are pushed into the query itself; `withinDateWindow` below is
  // a defensive re-check, not the primary filter.
  const { data: eventRows, error } = await admin
    .from('sumup_transaction_events')
    .select('id, due_date, installment_number, sumup_transactions!inner(id, amount, installments_count, status)')
    .eq('org_id', orgId)
    .eq('event_type', 'PAYOUT')
    .eq('installment_number', installmentNumber)
    .gte('due_date', shiftDateString(ar.data_vencimento, -DATE_WINDOW_DAYS))
    .lte('due_date', shiftDateString(ar.data_vencimento, DATE_WINDOW_DAYS))
    .eq('sumup_transactions.status', 'SUCCESSFUL')

  if (error) {
    throw new Error(`Failed to load sumup_transaction_events candidates: ${error.message}`)
  }

  const candidates: MatchCandidate[] = []
  for (const row of (eventRows ?? []) as unknown as SumupEventCandidateRow[]) {
    const transaction = row.sumup_transactions
    if (!transaction || transaction.amount === null || !transaction.installments_count) continue
    if (!row.due_date || !withinDateWindow(ar.data_vencimento, row.due_date)) continue

    const grossEstimate = computeGrossEstimate(transaction.amount, transaction.installments_count)
    if (grossEstimate === null || !withinAmountTolerance(ar.valor, grossEstimate)) continue

    candidates.push({
      sumupTransactionEventId: row.id,
      sumupTransactionId: transaction.id,
      dueDate: row.due_date,
      grossEstimate,
    })
  }

  return classifyCandidates(ar.valor, candidates)
}
