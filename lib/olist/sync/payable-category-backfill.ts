import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { olistFetch } from '@/lib/olist/client'
import { fetchAllPages } from '@/lib/reconciliation/run'

type PayableCategoryDetail = {
  id: number
  categoria?: { id: number; descricao: string | null } | null
  valorPago?: number | null
  dataLiquidacao?: string | null
}

export type PayableCategoryBackfillResult = {
  processed: number
  updated: number
  already_complete: number
  not_found: number
  rate_limited: number
  errors: string[]
}

/**
 * Idempotently enriches only payable rows that need detail data. The Olist
 * client owns rate limiting/retry/backoff; this job never runs from a page
 * render and can safely be retried after an OAuth recovery.
 */
export async function backfillPayableCategories(
  orgId: string,
  options: { watermark?: string; batchSize?: number } = {},
): Promise<PayableCategoryBackfillResult> {
  const admin = createAdminSupabaseClient()
  const result: PayableCategoryBackfillResult = {
    processed: 0,
    updated: 0,
    already_complete: 0,
    not_found: 0,
    rate_limited: 0,
    errors: [],
  }

  const missing = await fetchAllPages<{ id: string; olist_id: number; categoria: string | null; synced_at: string | null }>(
    (from, to) => {
      let query = admin
        .from('olist_accounts_payable')
        .select('id, olist_id, categoria, synced_at')
        .eq('org_id', orgId)
        .or(options.watermark ? `categoria.is.null,categoria.eq.,synced_at.gt.${options.watermark}` : 'categoria.is.null,categoria.eq.')
        .range(from, to)
      return query
    },
    'Failed to load payables for category backfill',
  )

  const batchSize = Math.max(1, options.batchSize ?? 25)
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    const batch = missing.slice(offset, offset + batchSize)
    for (const payable of batch) {
      result.processed += 1
      try {
        const detail = await olistFetch<PayableCategoryDetail>(orgId, `/contas-pagar/${payable.olist_id}`)
        const update: Record<string, unknown> = {}
        if (detail.categoria?.id !== undefined) update.categoria_id = detail.categoria.id
        if (detail.categoria?.descricao?.trim()) update.categoria = detail.categoria.descricao.trim()
        if (detail.valorPago !== null && detail.valorPago !== undefined) update.valor_pago = detail.valorPago
        if (detail.dataLiquidacao) update.data_liquidacao = detail.dataLiquidacao

        if (Object.keys(update).length === 0) {
          result.already_complete += payable.categoria?.trim() ? 1 : 0
          continue
        }

        const { error } = await admin.from('olist_accounts_payable').update(update).eq('id', payable.id).eq('org_id', orgId)
        if (error) throw new Error(`persist ${payable.olist_id}: ${error.message}`)
        result.updated += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('(404)')) result.not_found += 1
        else if (message.includes('(429)')) result.rate_limited += 1
        else result.errors.push(`payable ${payable.olist_id}: ${message}`)
      }
    }
  }

  return result
}
