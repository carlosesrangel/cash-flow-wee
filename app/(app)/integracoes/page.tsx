import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { getOlistConnectionStatus } from '@/lib/olist/status'
import { checkSumupStatus } from '@/lib/sumup/status'
import { OlistCard } from '@/components/integrations/olist-card'
import { SumupCard } from '@/components/integrations/sumup-card'

export default async function IntegracoesPage() {
  const member = await getCurrentMember()

  const olistStatus = member
    ? await getOlistConnectionStatus(member.orgId)
    : { status: 'desconectado' as const, connectedAt: null }

  const canManage = Boolean(member && canManageIntegrations(member.role))

  // Unlike the Olist status (a local DB read), checking SumUp means a live
  // outbound call to their API on every render. Only spend it on users who can
  // act on the result — everyone else sees "não verificado".
  const sumupStatus = canManage ? await checkSumupStatus() : ('nao_verificado' as const)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Saúde das Integrações</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <OlistCard
          status={olistStatus.status}
          connectedAt={olistStatus.connectedAt}
          canManage={canManage}
        />
        <SumupCard status={sumupStatus} canManage={canManage} />
      </div>
    </div>
  )
}
