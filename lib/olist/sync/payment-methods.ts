import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistPaymentMethod = {
  id: number
  nome: string | null
  situacao: string | null
}

export async function syncPaymentMethods(
  orgId: string
): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  for await (const page of paginateOlist<OlistPaymentMethod>(orgId, '/formas-pagamento', {})) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((method) => ({
      org_id: orgId,
      olist_id: method.id,
      nome: method.nome,
      situacao: method.situacao,
      raw: method,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_payment_methods').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_payment_methods: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
