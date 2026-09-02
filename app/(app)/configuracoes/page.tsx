import { getCurrentMember } from '@/lib/auth/session'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getOlistConnectionStatus } from '@/lib/olist/status'
import { loadIntegrationFreshness } from '@/lib/integrations/freshness'
import { checkSumupStatus } from '@/lib/sumup/status'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { UserManagement } from '@/components/settings/user-management'
import { canManageUsers } from '@/lib/auth/rbac'

const ROLE_LABEL: Record<string, string> = {
  OWNER_ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  VIEWER: 'Visualizador',
}

export default async function ConfiguracoesPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <EmptyState title="Acesso negado" description="Faça login para ver as configurações." />
  }

  const admin = createAdminSupabaseClient()

  const [{ data: org }, { data: members }, olistStatus, freshness] = await Promise.all([
    admin.from('organizations').select('id, name, created_at').eq('id', member.orgId).single(),
    admin.from('organization_members').select('id, profile_id, role, active, created_at').eq('org_id', member.orgId),
    getOlistConnectionStatus(member.orgId),
    loadIntegrationFreshness(member.orgId),
  ])

  const canManage = canManageIntegrations(member.role)
  const sumupStatus = canManage ? await checkSumupStatus() : ('nao_verificado' as const)

  const profileIds = (members ?? []).map((m) => m.profile_id)
  const { data: profiles } = profileIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', profileIds)
    : { data: [] }
  const nameByProfileId = new Map((profiles ?? []).map((p) => [p.id, p.full_name]))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Organização, integrações, usuários e regras de cálculo da plataforma"
      />

      {/* Organização */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Organização</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Nome</dt>
              <dd className="text-sm font-medium text-foreground mt-1">{org?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Criada em</dt>
              <dd className="text-sm font-medium text-foreground mt-1">
                {org?.created_at ? new Date(org.created_at).toLocaleDateString('pt-BR') : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Moeda</dt>
              <dd className="text-sm font-medium text-foreground mt-1">BRL — Real Brasileiro</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">ID da Organização</dt>
              <dd className="text-xs font-mono text-muted-foreground mt-1">{org?.id}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Integrações */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Integrações</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">Olist ERP</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {olistStatus.status === 'precisa_reautorizar'
                    ? 'Autorização expirada'
                    : olistStatus.connectedAt
                      ? `Conectado em ${new Date(olistStatus.connectedAt).toLocaleDateString('pt-BR')}`
                      : 'Não conectado'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Última sync: {olistStatus.lastSyncAt ? new Date(olistStatus.lastSyncAt).toLocaleString('pt-BR') : 'Nunca'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Contas a pagar categorizadas: {olistStatus.payableCategories.categorized}/{olistStatus.payableCategories.total} ({olistStatus.payableCategories.coveragePct.toFixed(1)}%)
                </p>
              </div>
              <Badge
                variant={olistStatus.status === 'conectado' ? 'default' : 'destructive'}
                className={olistStatus.status === 'conectado' ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200' : ''}
              >
                {olistStatus.status === 'conectado' ? 'Conectado' : olistStatus.status === 'precisa_reautorizar' ? 'Autorização expirada' : 'Desconectado'}
              </Badge>
              {canManage && olistStatus.status === 'precisa_reautorizar' && (
                <a href="/api/integracoes/olist/connect" className="ml-3 text-xs font-medium text-primary underline">
                  Reconectar Olist
                </a>
              )}
            </div>
            <div className="rounded-lg border border-border p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">SumUp</p>
                <p className="text-xs text-muted-foreground mt-0.5">Pagamentos com cartão e repasses</p>
              </div>
              <Badge
                variant={sumupStatus === 'configurado' ? 'default' : 'secondary'}
                className={sumupStatus === 'configurado' ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200' : ''}
              >
                {sumupStatus === 'configurado' ? 'Conectado' : sumupStatus === 'nao_verificado' ? 'Não verificado' : 'Erro de Configuração'}
              </Badge>
            </div>
          </div>
          <div className="mt-4 grid gap-3 rounded-lg border border-border p-4 text-xs text-muted-foreground sm:grid-cols-2">
            <p>Tiny/Olist — {freshness.lastOlistSync ? new Date(freshness.lastOlistSync).toLocaleString('pt-BR') : 'Nunca'} ({freshness.olistStatus ?? 'sem execução'})</p>
            <p>SumUp — {freshness.lastSumupSync ? new Date(freshness.lastSumupSync).toLocaleString('pt-BR') : 'Nunca'} ({freshness.sumupStatus ?? 'sem execução'})</p>
            <p>Financeiro — {freshness.lastAnalyticsRefresh ? new Date(freshness.lastAnalyticsRefresh).toLocaleString('pt-BR') : 'Nunca'}</p>
            <p>Ledger — {freshness.lastLedgerRefresh ? new Date(freshness.lastLedgerRefresh).toLocaleString('pt-BR') : 'Nunca'}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Gerencie conexões e reautorização na aba <span className="font-medium">Integrações</span>. A sincronização
            automática roda diariamente via GitHub Actions (Olist 02:00 UTC, SumUp 03:00 UTC).
          </p>
        </CardContent>
      </Card>

      {/* Usuários */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Usuários</CardTitle>
        </CardHeader>
        <CardContent>
          {canManageUsers(member.role) ? <UserManagement /> : (members ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Nome</th>
                    <th className="px-4 py-2 text-left font-medium">Função</th>
                    <th className="px-4 py-2 text-left font-medium">Desde</th>
                  </tr>
                </thead>
                <tbody>
                  {(members ?? []).map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="px-4 py-2">{nameByProfileId.get(m.profile_id) || 'Sem nome cadastrado'}</td>
                      <td className="px-4 py-2">
                        <Badge variant="outline">{ROLE_LABEL[m.role] ?? m.role}</Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(m.created_at).toLocaleDateString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Regras de Cálculo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Regras de Cálculo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="font-medium text-foreground">Alíquota de Imposto</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calculada por competência com RBT12 e a fórmula da faixa; sem base disponível não há estimativa automática.
              </p>
            </div>
            <span className="text-lg font-mono font-semibold text-primary">Dinâmica</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="font-medium text-foreground">Vencimento de Impostos</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Dia fixo de vencimento no mês subsequente à receita de referência
              </p>
            </div>
            <span className="text-lg font-mono font-semibold text-primary">Dia 20</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div>
              <p className="font-medium text-foreground">Janela Padrão de Contas a Pagar/Receber</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Período exibido por padrão ao abrir as telas de contas
              </p>
            </div>
            <span className="text-lg font-mono font-semibold text-primary">Hoje + 60 dias</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
