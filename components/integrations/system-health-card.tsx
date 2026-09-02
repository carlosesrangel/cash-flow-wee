import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBRL } from '@/lib/format/currency'
import type { SystemHealth } from '@/lib/observability/system-health'

const STATUS_LABEL: Record<string, string> = {
  HEALTHY: 'Saudável',
  STALE: 'Desatualizada',
  DEGRADED: 'Degradada',
  AUTH_REQUIRED: 'Reautorização necessária',
  FAILED: 'Falhou',
  NEVER_SYNCED: 'Nunca sincronizada',
}

function statusVariant(status: string) {
  return status === 'HEALTHY' ? 'success' as const : status === 'AUTH_REQUIRED' || status === 'FAILED' ? 'destructive' as const : 'warning' as const
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Nunca'
}

export function SystemHealthCard({ health }: { health: SystemHealth }) {
  return (
    <Card aria-labelledby="system-health-title">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle id="system-health-title">Saúde do Sistema</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Sinais operacionais derivados dos últimos runs e dos dados persistidos.</p>
          </div>
          <Badge variant={health.financial.reconciliationStatus === 'PASS' ? 'success' : 'warning'}>{health.financial.reconciliationStatus === 'PASS' ? 'Financeiro íntegro' : 'Atenção financeira'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {health.integrations.map((item) => (
            <div key={item.provider} className="rounded-lg border bg-muted/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{item.provider === 'olist' ? 'Tiny/Olist' : item.provider === 'sumup' ? 'SumUp' : item.provider === 'analytics' ? 'Analytics' : 'Ledger'}</p>
                <Badge variant={statusVariant(item.status)}>{STATUS_LABEL[item.status] ?? item.status}</Badge>
              </div>
              <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div><dt>Último sucesso</dt><dd className="font-medium text-foreground">{dateTime(item.lastSuccessfulSyncAt)}</dd></div>
                <div><dt>Freshness</dt><dd className="font-medium text-foreground">{item.freshness}{item.freshnessAgeHours != null ? ` · ${item.freshnessAgeHours.toFixed(1)}h` : ''}</dd></div>
                <div><dt>Última tentativa</dt><dd className="font-medium text-foreground">{dateTime(item.lastAttemptAt)}</dd></div>
                <div><dt>Registros recebidos</dt><dd className="font-medium text-foreground">{item.recordsReceived ?? 'Não medido'}</dd></div>
              </dl>
              {item.lastErrorMessage && <p className="mt-3 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800">{item.lastErrorCode ? `${item.lastErrorCode}: ` : ''}{item.lastErrorMessage}</p>}
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HealthMetric label="Pedidos persistidos" value={String(health.olist.orderCount)} detail={`Último pedido ${health.olist.latestOrderNumber ?? '—'}`} />
          <HealthMetric label="Fonte Olist até" value={health.olist.latestOrderDate ? new Date(`${health.olist.latestOrderDate}T00:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'} detail={health.olist.dataAgeDays == null ? 'Sem data disponível' : `${health.olist.dataAgeDays} dias desde o último pedido`} />
          <HealthMetric label="Bridge assinado" value={formatBRL(health.financial.signedBridgeDifference)} detail="diferença esperada: R$ 0,00" />
          <HealthMetric label="Matches verificados" value={String(health.financial.verifiedMatches)} detail={`${health.financial.legacyMatches} legados · ${health.financial.ambiguousMatches} ambíguos`} />
        </div>
        <div className="rounded-lg border bg-muted/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Qualidade fiscal</p><p className="text-xs text-muted-foreground">Sem fallback silencioso para data_faturamento.</p></div><Badge variant={health.olist.coverage.unexpectedMissing === 0 ? 'success' : 'warning'}>{health.olist.coverage.unexpectedMissing === 0 ? 'Sem ausências inesperadas' : `${health.olist.coverage.unexpectedMissing} ausências inesperadas`}</Badge></div>
          <p className="mt-2 text-xs text-muted-foreground">Janela RBT12 {health.olist.coverage.period}: {health.olist.coverage.invoiced}/{health.olist.coverage.total} pedidos faturados ({health.olist.coverage.percent.toFixed(2)}%) · {health.olist.coverage.preInvoice} pré-faturas · {health.olist.coverage.cancelled} cancelados. Geral persistido: {health.olist.coverage.allInvoiced}/{health.olist.coverage.allPersisted} ({health.olist.coverage.allPercent.toFixed(2)}%).</p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Checks operacionais">
          {health.checks.map((check) => <Badge key={check.key} variant={check.status === 'PASS' ? 'success' : 'destructive'}>{check.key}: {check.status}</Badge>)}
        </div>
        <div className="space-y-2" aria-label="Alertas operacionais">
          <p className="text-sm font-medium">Alertas operacionais</p>
          {health.alerts.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma exceção detectada.</p> : health.alerts.map((alert) => <div key={alert.key} className="rounded-md border bg-muted/10 px-3 py-2 text-xs"><span className="mr-2 font-semibold">{alert.severity}</span>{alert.message}</div>)}
        </div>
        <p className="text-[11px] text-muted-foreground">Atualizado em {dateTime(health.generatedAt)} · thresholds centralizados: aviso 36h, stale 72h, crítico 168h para jobs diários.</p>
      </CardContent>
    </Card>
  )
}

function HealthMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-lg border p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-semibold text-primary">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{detail}</p></div>
}
