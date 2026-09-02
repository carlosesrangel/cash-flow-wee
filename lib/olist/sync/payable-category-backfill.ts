import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { olistFetch } from '@/lib/olist/client'
import { fetchAllPages } from '@/lib/reconciliation/run'

type PayableCategoryDetail = {
  id: number
  categoria?: { id: number; descricao: string | null } | null
  valorPago?: number | null
  dataLiquidacao?: string | null
}

type PayableCategoryCandidate = {
  categoria: string | null
  categoria_id: number | null
  valor_pago: number | null
  data_liquidacao: string | null
}

export type PayableCategoryBackfillResult = {
  processed: number
  updated: number
  already_complete: number
  not_found: number
  rate_limited: number
  errors: string[]
}

export function buildPayableCategoryUpdate(
  payable: PayableCategoryCandidate,
  detail: PayableCategoryDetail,
): Record<string, unknown> {
  const update: Record<string, unknown> = {}
  const categoryDescription = detail.categoria?.descricao?.trim()

  if (detail.categoria?.id !== undefined && detail.categoria.id !== payable.categoria_id) {
    update.categoria_id = detail.categoria.id
  }
  if (categoryDescription && categoryDescription !== payable.categoria?.trim()) {
    update.categoria = categoryDescription
  }
  if (detail.valorPago !== null && detail.valorPago !== undefined && detail.valorPago !== payable.valor_pago) {
    update.valor_pago = detail.valorPago
  }
  if (detail.dataLiquidacao && detail.dataLiquidacao !== payable.data_liquidacao) {
    update.data_liquidacao = detail.dataLiquidacao
  }

  return update
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

  const missing = await fetchAllPages<{
    id: string
    olist_id: number
    categoria: string | null
    categoria_id: number | null
    valor_pago: number | null
    data_liquidacao: string | null
    synced_at: string | null
  }>(
    (from, to) => {
      let query = admin
        .from('olist_accounts_payable')
        .select('id, olist_id, categoria, categoria_id, valor_pago, data_liquidacao, synced_at')
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
        const update = buildPayableCategoryUpdate(payable, detail)

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
