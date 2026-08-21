import { getCurrentMember } from '@/lib/auth/session'
import { loadAllVersions, loadVersionEntries } from '@/lib/forecast/engine'
import { computeTaxSchedule, DEFAULT_TAX_RATE } from '@/lib/tax/engine'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/ui/metric-card'
import { EmptyState } from '@/components/ui/empty-state'
import { TaxScheduleTable } from '@/components/tax/tax-schedule-table'
import { formatBRL } from '@/lib/format/currency'

export default async function ImpostosPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <EmptyState title="Acesso negado" description="Faça login para ver os impostos." />
  }

  const versions = await loadAllVersions(member.orgId)

  if (versions.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Impostos"
          subtitle="Gestão tributária"
          description="Configure seu regime tributário e acompanhe obrigações fiscais"
        />
        <EmptyState
          title="Nenhuma projeção de receita cadastrada"
          description="Crie uma versão em Planejamento para calcular os impostos estimados sobre a receita projetada."
        />
      </div>
    )
  }

  const currentVersion = versions[0]
  const entries = await loadVersionEntries(member.orgId, currentVersion.id)
  const schedule = computeTaxSchedule(entries, DEFAULT_TAX_RATE)

  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const in60 = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000)
  const in60Key = `${in60.getFullYear()}-${String(in60.getMonth() + 1).padStart(2, '0')}-${String(in60.getDate()).padStart(2, '0')}`

  const upcoming = schedule.filter((s) => s.vencimento >= todayKey && s.vencimento <= in60Key)
  const totalUpcoming = upcoming.reduce((sum, s) => sum + s.valorImposto, 0)
  const totalProjetado = schedule.reduce((sum, s) => sum + s.receitaProjetada, 0)
  const totalImpostoAno = schedule.reduce((sum, s) => sum + s.valorImposto, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Impostos"
        subtitle={`Baseado em: ${currentVersion.name}`}
        description={`Estimativa via Simples Nacional (alíquota ${(DEFAULT_TAX_RATE * 100).toFixed(1)}%), vencimento sempre no dia 20 do mês subsequente à receita`}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Imposto (Próximos 60 dias)"
          value={formatBRL(totalUpcoming)}
          accentColor="red"
          footnote={`${upcoming.length} obrigação(ões)`}
        />
        <MetricCard label="Receita Projetada (12 meses)" value={formatBRL(totalProjetado)} accentColor="navy" />
        <MetricCard label="Imposto Total Estimado (12 meses)" value={formatBRL(totalImpostoAno)} accentColor="navy" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Calendário de Obrigações</CardTitle>
        </CardHeader>
        <CardContent>
          <TaxScheduleTable schedule={schedule} today={todayKey} />
        </CardContent>
      </Card>
    </div>
  )
}
