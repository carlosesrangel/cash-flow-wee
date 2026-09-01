import Link from 'next/link'
import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { loadAllVersions, loadVersionEntries, loadSalesMixForVersion, loadCMVProjectionsForVersion, loadProjectedARForVersion } from '@/lib/forecast/engine'
import { loadMonthlyRevenue } from '@/lib/analytics/engine'
import { formatBRL } from '@/lib/format/currency'
import { PlanningTabbedGrid } from '@/components/forecast/planning-tabbed-grid'
import { NewVersionForm } from '@/components/forecast/new-version-form'

export default async function PlanejamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ versao?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o planejamento.</p>
  }

  const versions = await loadAllVersions(member.orgId)
  if (versions.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhuma versão de forecast cadastrada ainda.</p>
  }

  const { versao } = await searchParams
  const selected = versions.find((v) => v.id === versao) ?? versions[0]
  const isCurrent = selected.id === versions[0].id
  const entries = await loadVersionEntries(member.orgId, selected.id)
  const salesMix = await loadSalesMixForVersion(selected.id)
  const cmvProjections = await loadCMVProjectionsForVersion(selected.id)
  const projectedAR = await loadProjectedARForVersion(selected.id)
  const monthlyRevenue = await loadMonthlyRevenue(member.orgId, 12, new Date('2026-06-01T00:00:00Z'), new Date('2026-09-30T23:59:59Z'))
  const monthlyByKey = new Map(monthlyRevenue.map((month) => [month.month.slice(0, 7), month]))
  const summaryRows = entries
    .filter((entry) => entry.ano === 2026 && entry.mes >= 6 && entry.mes <= 8)
    .map((entry) => {
      const planningKey = `${entry.ano}-${String(entry.mes).padStart(2, '0')}`
      const nextMonth = entry.mes === 12 ? `${entry.ano + 1}-01` : `${entry.ano}-${String(entry.mes + 1).padStart(2, '0')}`
      const actual = monthlyByKey.get(nextMonth)
      return { ...entry, total: entry.value, realizado: actual?.realized ?? null, pendente: actual?.pending ?? null, faturas: actual?.invoiceCount ?? null, planningKey }
    })
  const summaryTotals = summaryRows.reduce((sum, row) => ({ total: sum.total + row.total, realizado: sum.realizado + (row.realizado ?? 0), pendente: sum.pendente + (row.pendente ?? 0) }), { total: 0, realizado: 0, pendente: 0 })
  const canEdit = canEditForecast(member.role)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Planejamento de Receita</h1>
        <Link href="/planejamento/forecast-vs-realizado" className="text-sm text-neutral-600 underline">
          Forecast vs Realizado
        </Link>
      </div>
      <form className="flex items-center gap-2">
        <label htmlFor="versao" className="text-sm text-neutral-600">
          Versão
        </label>
        <select id="versao" name="versao" defaultValue={selected.id} className="rounded border px-2 py-1 text-sm">
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.id === versions[0].id ? ' (atual)' : ''}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
          Ver
        </button>
      </form>
      <section aria-labelledby="planning-summary-title" className="space-y-4">
        <div><h2 id="planning-summary-title" className="text-lg font-semibold">Resumo do período</h2><p className="text-sm text-neutral-500">Planejado, realizado e pendente por competência.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PlanningMetric label="Planejado" value={summaryTotals.total} />
          <PlanningMetric label="Realizado" value={summaryTotals.realizado} />
          <PlanningMetric label="Pendente" value={summaryTotals.pendente} />
          <PlanningMetric label="% realizado" value={summaryTotals.total > 0 ? `${((summaryTotals.realizado / summaryTotals.total) * 100).toFixed(1)}%` : '—'} />
        </div>
        <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50 text-muted-foreground"><tr><th className="px-4 py-3">Mês</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Realizado</th><th className="px-4 py-3 text-right">Pendente</th><th className="px-4 py-3 text-right">Faturas</th></tr></thead><tbody>{summaryRows.map((row) => <tr key={row.planningKey} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${row.planningKey}-01T00:00:00Z`))}</td><td className="px-4 py-3 text-right font-mono">{formatBRL(row.total)}</td><td className="px-4 py-3 text-right font-mono">{row.realizado == null ? '—' : formatBRL(row.realizado)}</td><td className="px-4 py-3 text-right font-mono">{row.pendente == null ? '—' : formatBRL(row.pendente)}</td><td className="px-4 py-3 text-right">{row.faturas ?? '—'}</td></tr>)}</tbody></table></div>
      </section>
      {canEdit && <NewVersionForm />}
      <PlanningTabbedGrid
        versionId={selected.id}
        entries={entries}
        canEdit={canEdit && isCurrent}
        salesMix={salesMix}
        cmvProjections={cmvProjections}
        projectedAR={projectedAR}
      />
    </div>
  )
}

function PlanningMetric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg border bg-card p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-mono text-2xl font-semibold">{typeof value === 'number' ? formatBRL(value) : value}</p></div>
}
