import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toOlistDateParam, emptyToNull } from '@/lib/olist/date'

type OlistAccountPayable = {
  id: number
  situacao: string | null
  data: string | null
  dataVencimento: string | null
  historico: string | null
  valor: number | null
  saldo: number | null
  numeroDocumento: string | null
  serieDocumento: string | null
  cliente?: { id: number } | null
}

/**
 * Syncs accounts payable via a sliding-window incremental strategy: the
 * Olist `/contas-pagar` endpoint has no "updated since" filter, so every
 * sync run reprocesses the last `windowDays` days of `dataVencimento`
 * (default 90) up through all future-dated accounts, rather than filtering
 * by a last-synced timestamp like the other sync tasks.
 */
export async function syncAccountsPayable(
  orgId: string,
  options: { windowDays?: number } = {}
): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const windowDays = options.windowDays ?? 90
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - windowDays)

  const query = { dataInicialVencimento: toOlistDateParam(windowStart) }

  for await (const page of paginateOlist<OlistAccountPayable>(orgId, '/contas-pagar', query)) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((account) => ({
      org_id: orgId,
      olist_id: account.id,
      situacao: account.situacao,
      data_emissao: emptyToNull(account.data),
      data_vencimento: emptyToNull(account.dataVencimento),
      historico: account.historico,
      valor: account.valor,
      saldo: account.saldo,
      numero_documento: account.numeroDocumento,
      serie_documento: account.serieDocumento,
      fornecedor_olist_id: account.cliente?.id ?? null,
      raw: account,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_accounts_payable').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_accounts_payable: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
