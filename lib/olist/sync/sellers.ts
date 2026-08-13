import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistSeller = {
  id: number
  nome: string | null
  situacao: string | null
  contato?: { id: number } | null
}

export async function syncSellers(orgId: string): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  for await (const page of paginateOlist<OlistSeller>(orgId, '/vendedores', {})) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((seller) => ({
      org_id: orgId,
      olist_id: seller.id,
      nome: seller.nome,
      situacao: seller.situacao,
      contato_olist_id: seller.contato?.id ?? null,
      raw: seller,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_sellers').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_sellers: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
