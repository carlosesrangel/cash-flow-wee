import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { aggregateByDay, aggregateByMonth } from '@/lib/cash-flow/aggregate'
import { toLocalDateParam } from '@/lib/integrations/date'
import { AnnualTable } from '@/components/cash-flow/annual-table'

export default async function FluxoDeCaixaAnualPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o fluxo de caixa.</p>
  }

  const { ano } = await searchParams
  const currentYear = Number(toLocalDateParam(new Date()).slice(0, 4))
  const year = ano && /^\d{4}$/.test(ano) ? Number(ano) : currentYear
  const from = `${year}-01-01`
  const to = `${year}-12-31`

  const entries = await loadCashFlowEntries(member.orgId)
  const opening = await resolveOpeningBalance(member.orgId, from, entries)
  const days = aggregateByDay(entries, { from, to }, opening)
  const months = aggregateByMonth(days)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fluxo de Caixa — Anual</h1>
      <form className="flex items-center gap-2">
        <label htmlFor="ano" className="text-sm text-neutral-600">
          Ano
        </label>
        <input id="ano" name="ano" type="number" defaultValue={year} className="w-24 rounded border px-2 py-1 text-sm" />
        <button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
          Ver
        </button>
      </form>
      <AnnualTable months={months} />
    </div>
  )
}
