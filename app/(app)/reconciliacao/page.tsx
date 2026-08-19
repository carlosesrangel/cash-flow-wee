import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ReconciliationTable, type MatchRow } from '@/components/reconciliation/reconciliation-table'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

export default async function ReconciliacaoPage() {
  const member = await getCurrentMember()

  if (!member) {
    return <EmptyState title="Acesso negado" description="Faça login para ver a reconciliação." />
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
      <PageHeader
        title="Reconciliação Financeira"
        description="Vinculação entre recebíveis, transações SumUp e saldo confirmado"
      />
      <Card>
        <CardContent className="pt-6">
          <ReconciliationTable matches={(data ?? []) as unknown as MatchRow[]} canManage={canManageReconciliation(member.role)} />
        </CardContent>
      </Card>
    </div>
  )
}
