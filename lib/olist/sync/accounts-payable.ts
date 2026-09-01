import { paginateOlist } from '@/lib/olist/paginate'
import { olistFetch } from '@/lib/olist/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam, emptyToNull } from '@/lib/integrations/date'

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

type OlistAccountPayableDetail = {
  id: number
  valorPago: number | null
  dataLiquidacao: string | null
  categoria?: { id: number; descricao: string | null } | null
}

type ExistingPayable = {
  olist_id: number
  situacao: string | null
  data_vencimento: string | null
  valor: number | null
  saldo: number | null
  categoria_id: number | null
  categoria: string | null
  valor_pago: number | null
  data_liquidacao: string | null
  raw: Record<string, unknown> | null
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
): Promise<{ received: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const windowDays = options.windowDays ?? 90
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - windowDays)

  const query = { dataInicialVencimento: toLocalDateParam(windowStart) }

  for await (const page of paginateOlist<OlistAccountPayable>(orgId, '/contas-pagar', query)) {
    if (page.length === 0) continue
    received += page.length

    const ids = page.map((account) => account.id)
    const { data: existingRows, error: existingError } = await admin
      .from('olist_accounts_payable')
      .select('olist_id, situacao, data_vencimento, valor, saldo, categoria_id, categoria, valor_pago, data_liquidacao, raw')
      .eq('org_id', orgId)
      .in('olist_id', ids)
    if (existingError) throw new Error(`Failed to load existing payables: ${existingError.message}`)
    const existingById = new Map((existingRows ?? []).map((row) => [row.olist_id as number, row as ExistingPayable]))

    const rows = []
    for (const account of page) {
      const existing = existingById.get(account.id)
      const changed = !existing ||
        existing.situacao !== account.situacao ||
        existing.data_vencimento !== emptyToNull(account.dataVencimento) ||
        existing.valor !== account.valor ||
        existing.saldo !== account.saldo
      const needsDetail = !existing || !existing.categoria?.trim() || changed
      const detail = needsDetail ? await olistFetch<OlistAccountPayableDetail>(orgId, `/contas-pagar/${account.id}`) : null

      rows.push({
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
        categoria_id: detail?.categoria?.id ?? existing?.categoria_id ?? null,
        categoria: detail?.categoria?.descricao ?? existing?.categoria ?? null,
        valor_pago: detail?.valorPago ?? existing?.valor_pago ?? null,
        data_liquidacao: emptyToNull(detail?.dataLiquidacao) ?? existing?.data_liquidacao ?? null,
        raw: detail ? { ...account, detail } : existing?.raw ?? account,
        synced_at: new Date().toISOString(),
      })
    }

    const { error } = await admin.from('olist_accounts_payable').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_accounts_payable: ${error.message}`)
  }

  return { received }
}
