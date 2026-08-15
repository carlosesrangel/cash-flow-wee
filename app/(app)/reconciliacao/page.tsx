import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ReconciliationTable, type MatchRow } from '@/components/reconciliation/reconciliation-table'

export default async function ReconciliacaoPage() {
  const member = await getCurrentMember()

  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver a reconciliação.</p>
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('reconciliation_matches')
    .select(
      'id, status, candidate_ids, match_reason, olist_accounts_receivable:olist_accounts_receivable_id (historico, numero_documento, valor, data_vencimento)'
    )
    .order('status', { ascending: true })

  if (error) {
    throw new Error(`Falha ao carregar reconciliação: ${error.message}`)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Reconciliação Financeira</h1>
      <ReconciliationTable matches={(data ?? []) as unknown as MatchRow[]} canManage={canManageReconciliation(member.role)} />
    </div>
  )
}
