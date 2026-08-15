import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { classifyAccountsPayable } from '@/lib/cash-flow/classify'
import { computeAgingBucket } from '@/lib/cash-flow/aging'
import { toLocalDateParam } from '@/lib/integrations/date'
import { AccountsPayableTable, type AccountsPayableRow } from '@/components/cash-flow/accounts-payable-table'

export default async function ContasAPagarPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver as contas a pagar.</p>
  }

  const supabase = await createServerSupabaseClient()
  const { data: apRows, error } = await supabase
    .from('olist_accounts_payable')
    .select('id, valor, saldo, situacao, data_vencimento, historico, numero_documento, fornecedor_olist_id')
    .order('data_vencimento', { ascending: true })

  if (error) {
    throw new Error(`Falha ao carregar contas a pagar: ${error.message}`)
  }

  const { data: contacts } = await supabase.from('olist_contacts').select('olist_id, nome')
  const contactNameByOlistId = new Map((contacts ?? []).map((c) => [c.olist_id as number, c.nome as string | null]))

  const today = toLocalDateParam(new Date())
  const rows: AccountsPayableRow[] = (apRows ?? []).map((row) => {
    const classification = classifyAccountsPayable(row)
    return {
      id: row.id,
      numeroDocumento: row.numero_documento,
      historico: row.historico,
      fornecedorNome: row.fornecedor_olist_id ? (contactNameByOlistId.get(row.fornecedor_olist_id) ?? null) : null,
      valor: row.valor,
      classification,
      agingBucket:
        classification.included && classification.bucket === 'contratado'
          ? computeAgingBucket(classification.date, today)
          : null,
    }
  })

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Contas a Pagar</h1>
      <AccountsPayableTable rows={rows} today={today} />
    </div>
  )
}
