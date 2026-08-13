import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistProduct = {
  id: number
  sku: string | null
  descricao: string | null
  tipo: string | null
  situacao: string | null
  unidade: string | null
  gtin: string | null
  tipoVariacao?: string | null
  dataCriacao?: string | null
  dataAlteracao?: string | null
  precos?: unknown
  estoque?: unknown
}

export async function syncProducts(orgId: string): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  for await (const page of paginateOlist<OlistProduct>(orgId, '/produtos', {})) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((product) => ({
      org_id: orgId,
      olist_id: product.id,
      sku: product.sku,
      descricao: product.descricao,
      tipo: product.tipo,
      situacao: product.situacao,
      unidade: product.unidade,
      gtin: product.gtin,
      tipo_variacao: product.tipoVariacao ?? null,
      precos: product.precos ?? null,
      estoque: product.estoque ?? null,
      data_criacao_olist: product.dataCriacao ?? null,
      data_atualizacao_olist: product.dataAlteracao ?? null,
      raw: product,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_products').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_products: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
