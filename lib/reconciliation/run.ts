import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam } from '@/lib/integrations/date'
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

/**
 * Runs the matching engine over every card-paid AR installment that doesn't
 * already have a resolved (auto or manual) `reconciliation_matches` row.
 * Idempotent: re-running never touches a row already resolved, and upserts
 * (rather than inserts) everything else — see the unique constraint on
 * `(org_id, olist_accounts_receivable_id)`.
 */
export async function runReconciliation(orgId: string): Promise<{ processed: number }> {
  const admin = createAdminSupabaseClient()
  let processed = 0

  const { data: resolvedRows, error: resolvedError } = await admin
    .from('reconciliation_matches')
    .select('olist_accounts_receivable_id')
    .eq('org_id', orgId)
    .in('status', RESOLVED_STATUSES)

  if (resolvedError) {
    throw new Error(`Failed to load resolved reconciliation_matches: ${resolvedError.message}`)
  }

  const resolvedIds = (resolvedRows ?? []).map((row) => row.olist_accounts_receivable_id as string)

  let arQuery = admin
    .from('olist_accounts_receivable')
    .select('id, valor, data_vencimento, numero_documento, forma_recebimento_nome')
    .eq('org_id', orgId)
    .in('forma_recebimento_nome', CARD_PAYMENT_METHODS)

  if (resolvedIds.length > 0) {
    arQuery = arQuery.not('id', 'in', `(${resolvedIds.join(',')})`)
  }

  const { data: arRows, error: arError } = await arQuery

  if (arError) {
    throw new Error(`Failed to load olist_accounts_receivable candidates: ${arError.message}`)
  }

  for (const ar of (arRows ?? []) as AccountsReceivableRow[]) {
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

  return { processed }
}

async function matchOne(admin: AdminClient, orgId: string, ar: AccountsReceivableRow) {
  if (!ar.valor || !ar.data_vencimento) {
    return { status: 'nao_reconciliado' as const, matchReason: { motivo: 'valor_ou_vencimento_ausente' } }
  }

  const installmentNumber = parseInstallmentNumber(ar.numero_documento)
  if (installmentNumber === null) {
    return { status: 'nao_reconciliado' as const, matchReason: { motivo: 'numero_parcela_nao_identificado' } }
  }

  const dueDate = new Date(ar.data_vencimento)
  const windowStart = new Date(dueDate)
  windowStart.setDate(windowStart.getDate() - DATE_WINDOW_DAYS)
  const windowEnd = new Date(dueDate)
  windowEnd.setDate(windowEnd.getDate() + DATE_WINDOW_DAYS)

  // The date bounds are pushed into the query itself; `withinDateWindow`
  // below is a defensive re-check against day-boundary/timezone drift
  // between this JS Date math and Postgres date comparison, not the
  // primary filter.
  const { data: eventRows, error } = await admin
    .from('sumup_transaction_events')
    .select('id, due_date, installment_number, sumup_transactions!inner(id, amount, installments_count, status)')
    .eq('org_id', orgId)
    .eq('event_type', 'PAYOUT')
    .eq('installment_number', installmentNumber)
    .gte('due_date', toLocalDateParam(windowStart))
    .lte('due_date', toLocalDateParam(windowEnd))
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
