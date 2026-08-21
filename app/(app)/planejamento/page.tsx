import Link from 'next/link'
import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { loadAllVersions, loadVersionEntries, loadSalesMixForVersion, loadCMVProjectionsForVersion, loadProjectedARForVersion } from '@/lib/forecast/engine'
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
