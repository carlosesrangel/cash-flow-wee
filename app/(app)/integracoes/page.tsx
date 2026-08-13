import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentMember } from '@/lib/auth/session'
import { getOlistConnectionStatus } from '@/lib/olist/status'
import { OlistCard } from '@/components/integrations/olist-card'
import { formatDateBR } from '@/lib/format/date'

export default async function IntegracoesPage() {
  const supabase = await createServerSupabaseClient()
  const member = await getCurrentMember()

  const olistStatus = member
    ? await getOlistConnectionStatus(member.orgId)
    : { status: 'desconectado' as const, connectedAt: null }

  const { data: lastSumupRun } = await supabase
    .from('sync_runs')
    .select('status, finished_at')
    .eq('integration', 'sumup')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Saúde das Integrações</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <OlistCard status={olistStatus.status} connectedAt={olistStatus.connectedAt} />
        <div className="rounded-lg border bg-white p-4">
          <h2 className="font-medium">SumUp</h2>
          {lastSumupRun ? (
            <p className="mt-1 text-sm text-neutral-600">
              Última sincronização: {formatDateBR(lastSumupRun.finished_at ?? new Date())} —{' '}
              {lastSumupRun.status}
            </p>
          ) : (
            <p className="mt-1 text-sm text-neutral-500">Nenhuma sincronização registrada ainda.</p>
          )}
        </div>
      </div>
    </div>
  )
}
