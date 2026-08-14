import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  parseInstallmentNumber,
  computeGrossEstimate,
  withinAmountTolerance,
  withinDateWindow,
  classifyCandidates,
  type MatchCandidate,
} from '@/lib/reconciliation/match'

const RESOLVED_STATUSES = ['reconciliado_automaticamente', 'reconciliado_manualmente']
const CARD_PAYMENT_METHODS = ['Cartão de crédito', 'Cartão de débito']
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
        .in('status', RESOLVED_STATUSES)
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
