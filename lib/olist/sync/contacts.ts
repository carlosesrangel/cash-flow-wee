import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam, emptyToNull } from '@/lib/integrations/date'

type OlistContact = {
  id: number
  nome: string | null
  codigo?: string | null
  fantasia?: string | null
  tipoPessoa?: string | null
  cpfCnpj?: string | null
  inscricaoEstadual?: string | null
  telefone?: string | null
  celular?: string | null
  email?: string | null
  endereco?: unknown
  vendedor?: { id: number } | null
  situacao?: string | null
  statusCrm?: string | null
  dataCriacao?: string | null
  dataAtualizacao?: string | null
}

export async function syncContacts(
  orgId: string,
  options: { since?: Date } = {}
): Promise<{ received: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const query = options.since ? { dataAtualizacao: `${toLocalDateParam(options.since)} 00:00:00` } : {}

  for await (const page of paginateOlist<OlistContact>(orgId, '/contatos', query)) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((contact) => ({
      org_id: orgId,
      olist_id: contact.id,
      nome: contact.nome,
      codigo: contact.codigo ?? null,
      fantasia: contact.fantasia ?? null,
      tipo_pessoa: contact.tipoPessoa ?? null,
      cpf_cnpj: contact.cpfCnpj ?? null,
      inscricao_estadual: contact.inscricaoEstadual ?? null,
      telefone: contact.telefone ?? null,
      celular: contact.celular ?? null,
      email: contact.email ?? null,
      endereco: contact.endereco ?? null,
      vendedor_olist_id: contact.vendedor?.id ?? null,
      situacao: contact.situacao ?? null,
      status_crm: contact.statusCrm ?? null,
      data_criacao_olist: emptyToNull(contact.dataCriacao),
      data_atualizacao_olist: emptyToNull(contact.dataAtualizacao),
      raw: contact,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_contacts').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_contacts: ${error.message}`)
  }

  return { received }
}
