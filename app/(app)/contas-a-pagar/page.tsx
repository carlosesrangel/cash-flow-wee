import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { classifyAccountsPayable } from '@/lib/cash-flow/classify'
import { classifyPayableStatus } from '@/lib/payables/classify-status'
import { computeAgingBucket } from '@/lib/cash-flow/aging'
import { toLocalDateParam } from '@/lib/integrations/date'
import { AccountsPayableTable, type AccountsPayableRow } from '@/components/cash-flow/accounts-payable-table'
import { AccountsPayableFilters } from '@/components/cash-flow/accounts-payable-filters'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

export default async function ContasAPagarPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <EmptyState title="Acesso negado" description="Faça login para ver as contas a pagar." />
  }

  const supabase = await createServerSupabaseClient()
  const { data: apRows, error } = await supabase
    .from('olist_accounts_payable')
    .select('id, valor, saldo, valor_pago, situacao, data_vencimento, data_liquidacao, historico, numero_documento, fornecedor_olist_id, categoria_id, categoria')
    .eq('org_id', member.orgId)
    .order('data_vencimento', { ascending: true })

  if (error) {
    throw new Error(`Falha ao carregar contas a pagar: ${error.message}`)
  }

  const { data: contacts } = await supabase.from('olist_contacts').select('olist_id, nome').eq('org_id', member.orgId)
  const contactNameByOlistId = new Map((contacts ?? []).map((c) => [c.olist_id as number, c.nome as string | null]))

  const today = toLocalDateParam(new Date())
  const rows: AccountsPayableRow[] = (apRows ?? []).map((row) => {
    const classification = classifyAccountsPayable(row)
    const payableStatus = classifyPayableStatus(
      row.situacao,
      row.saldo,
      row.valor,
      row.data_vencimento,
      row.data_liquidacao,
      'America/Sao_Paulo'
    )
    return {
      id: row.id,
      numeroDocumento: row.numero_documento,
      historico: row.historico,
      fornecedorNome: row.fornecedor_olist_id ? (contactNameByOlistId.get(row.fornecedor_olist_id) ?? null) : null,
      valor: row.valor,
      saldo: row.saldo,
      valorPago: row.valor_pago,
      dataVencimento: row.data_vencimento,
      categoria: row.categoria,
      classification,
      payableStatus,
      agingBucket:
        classification.included && classification.bucket === 'contratado'
          ? computeAgingBucket(classification.date, today)
          : null,
    }
  })

  // Get unique suppliers for filter dropdown
  const suppliers = Array.from(
    new Map(rows.filter((r) => r.fornecedorNome).map((r) => [r.fornecedorNome!, r.fornecedorNome!])).values()
  ).sort()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas a Pagar"
        subtitle="Próximos Vencimentos"
        description="Acompanhe suas obrigações financeiras e datas de vencimento"
      />
      <Card>
        <CardContent className="pt-6 space-y-6">
          <AccountsPayableFilters rows={rows} suppliers={suppliers} today={today} />
        </CardContent>
      </Card>
    </div>
  )
}
