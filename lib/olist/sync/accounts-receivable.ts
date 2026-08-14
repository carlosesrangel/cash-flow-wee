import { paginateOlist } from '@/lib/olist/paginate'
import { olistFetch } from '@/lib/olist/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam, emptyToNull } from '@/lib/integrations/date'

type OlistAccountReceivable = {
  id: number
  situacao: string | null
  data: string | null
  dataVencimento: string | null
  historico: string | null
  valor: number | null
  saldo: number | null
  numeroDocumento: string | null
  numeroBanco: string | null
  serieDocumento?: string | null
  quantidadeParcelasAntecipadas: number | null
  cliente?: { id: number } | null
}

// Only exposed by the detail endpoint (GET /contas-receber/{id}), not the
// listing — see docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md,
// finding 4.
type OlistAccountReceivableDetail = {
  id: number
  taxa: number | null
  valorPago: number | null
  dataLiquidacao: string | null
  formaRecebimento?: { id: number; nome: string | null } | null
}

/**
 * Syncs accounts receivable via a sliding-window incremental strategy: the
 * Olist `/contas-receber` endpoint has no "updated since" filter, so every
 * sync run reprocesses the last `windowDays` days of `dataVencimento`
 * (default 90) up through all future-dated accounts, rather than filtering
 * by a last-synced timestamp like the other sync tasks. Mirrors Task 12's
 * accounts payable sync.
 *
 * As of Fase 4, also fetches the detail of every listed account (same N+1
 * pattern as `syncOrders`) to bring in `taxa`, `formaRecebimento`, and
 * `dataLiquidacao` — none of which the listing response includes, and all
 * of which the reconciliation engine needs. Fetching detail for every
 * account (not just card ones) is intentional: the listing gives no way to
 * know the payment method ahead of time, and the observed volume (~625
 * accounts on the real WEE account) is well within the rate limit already
 * enforced by `lib/olist/client.ts`.
 */
export async function syncAccountsReceivable(
  orgId: string,
  options: { windowDays?: number } = {}
): Promise<{ received: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const windowDays = options.windowDays ?? 90
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - windowDays)

  const query = { dataInicialVencimento: toLocalDateParam(windowStart) }

  for await (const page of paginateOlist<OlistAccountReceivable>(orgId, '/contas-receber', query)) {
    for (const account of page) {
      received += 1

      const detail = await olistFetch<OlistAccountReceivableDetail>(orgId, `/contas-receber/${account.id}`)

      const row = {
        org_id: orgId,
        olist_id: account.id,
        situacao: account.situacao,
        data_emissao: emptyToNull(account.data),
        data_vencimento: emptyToNull(account.dataVencimento),
        historico: account.historico,
        valor: account.valor,
        saldo: account.saldo,
        numero_documento: account.numeroDocumento,
        numero_banco: account.numeroBanco,
        serie_documento: account.serieDocumento ?? null,
        cliente_olist_id: account.cliente?.id ?? null,
        quantidade_parcelas_antecipadas: account.quantidadeParcelasAntecipadas,
        taxa: detail.taxa,
        valor_pago: detail.valorPago,
        forma_recebimento_id: detail.formaRecebimento?.id ?? null,
        forma_recebimento_nome: detail.formaRecebimento?.nome ?? null,
        data_liquidacao: emptyToNull(detail.dataLiquidacao),
        raw: { ...account, detail },
        synced_at: new Date().toISOString(),
      }

      const { error } = await admin.from('olist_accounts_receivable').upsert(row, { onConflict: 'org_id,olist_id' })
      if (error) throw new Error(`Failed to upsert olist_accounts_receivable ${account.id}: ${error.message}`)
    }
  }

  return { received }
}
