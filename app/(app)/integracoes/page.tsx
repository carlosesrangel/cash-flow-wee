import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { getOlistConnectionStatus } from '@/lib/olist/status'
import { checkSumupStatus } from '@/lib/sumup/status'
import { loadIntegrationFreshness } from '@/lib/integrations/freshness'
import { OlistCard } from '@/components/integrations/olist-card'
import { SumupCard } from '@/components/integrations/sumup-card'
import { PageHeader } from '@/components/ui/page-header'

export default async function IntegracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ sync?: string }>
}) {
  const { sync } = await searchParams
  const member = await getCurrentMember()

  const olistStatus = member
    ? await getOlistConnectionStatus(member.orgId)
    : {
        status: 'desconectado' as const,
        connectedAt: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        payableCategories: { categorized: 0, total: 0, coveragePct: 100 },
      }

  const canManage = Boolean(member && canManageIntegrations(member.role))

  // Unlike the Olist status (a local DB read), checking SumUp means a live
  // outbound call to their API on every render. Only spend it on users who can
  // act on the result — everyone else sees "não verificado".
  const sumupStatus = canManage ? await checkSumupStatus() : ('nao_verificado' as const)
  const freshness = member ? await loadIntegrationFreshness(member.orgId) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saúde das Integrações"
        description="Status de conexão com Olist ERP e SumUp"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <OlistCard
          status={olistStatus.status}
          connectedAt={olistStatus.connectedAt}
          canManage={canManage}
          lastSyncAt={olistStatus.lastSyncAt}
          lastSyncStatus={olistStatus.lastSyncStatus}
          payableCategories={olistStatus.payableCategories}
          autoSync={sync === '1'}
        />
        <SumupCard status={sumupStatus} canManage={canManage} />
      </div>
      {freshness && (
        <div className="grid gap-3 rounded-lg border bg-white p-4 text-sm text-neutral-600 sm:grid-cols-2">
          <p><span className="font-medium text-neutral-900">Tiny/Olist:</span> {freshness.lastOlistSync ? new Date(freshness.lastOlistSync).toLocaleString('pt-BR') : 'Nunca'} · {freshness.olistStatus ?? 'sem execução'}</p>
          <p><span className="font-medium text-neutral-900">SumUp:</span> {freshness.lastSumupSync ? new Date(freshness.lastSumupSync).toLocaleString('pt-BR') : 'Nunca'} · {freshness.sumupStatus ?? 'sem execução'}</p>
          <p><span className="font-medium text-neutral-900">Financeiro:</span> {freshness.lastAnalyticsRefresh ? new Date(freshness.lastAnalyticsRefresh).toLocaleString('pt-BR') : 'Nunca'}</p>
          <p><span className="font-medium text-neutral-900">Ledger:</span> {freshness.lastLedgerRefresh ? new Date(freshness.lastLedgerRefresh).toLocaleString('pt-BR') : 'Nunca'}</p>
        </div>
      )}
    </div>
  )
}
