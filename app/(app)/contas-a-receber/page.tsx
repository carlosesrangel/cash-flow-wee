import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { classifyAccountsReceivable } from '@/lib/cash-flow/classify'
import { computeAgingBucket } from '@/lib/cash-flow/aging'
import { loadReconciledCashDates } from '@/lib/cash-flow/engine'
import { toLocalDateParam } from '@/lib/integrations/date'
import { AccountsReceivableTable, type AccountsReceivableRow } from '@/components/cash-flow/accounts-receivable-table'

export default async function ContasAReceberPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver as contas a receber.</p>
  }

  const supabase = await createServerSupabaseClient()
  const { data: arRows, error } = await supabase
    .from('olist_accounts_receivable')
    .select('id, valor, saldo, situacao, data_vencimento, data_liquidacao, historico, numero_documento, cliente_olist_id')
    .order('data_vencimento', { ascending: true })

  if (error) {
    throw new Error(`Falha ao carregar contas a receber: ${error.message}`)
  }

  const { data: contacts } = await supabase.from('olist_contacts').select('olist_id, nome')
  const contactNameByOlistId = new Map((contacts ?? []).map((c) => [c.olist_id as number, c.nome as string | null]))

  const admin = createAdminSupabaseClient()
  const reconciledDates = await loadReconciledCashDates(admin, member.orgId)

  const today = toLocalDateParam(new Date())
  const rows: AccountsReceivableRow[] = (arRows ?? []).map((row) => {
    const classification = classifyAccountsReceivable(row, reconciledDates.get(row.id) ?? null)
    return {
      id: row.id,
      numeroDocumento: row.numero_documento,
      historico: row.historico,
      clienteNome: row.cliente_olist_id ? (contactNameByOlistId.get(row.cliente_olist_id) ?? null) : null,
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
      <h1 className="text-xl font-semibold">Contas a Receber</h1>
      <AccountsReceivableTable rows={rows} today={today} />
    </div>
  )
}
