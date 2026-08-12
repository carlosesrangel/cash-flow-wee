import { createServerSupabaseClient } from '@/lib/supabase/server'
import { formatDateBR } from '@/lib/format/date'

const INTEGRATIONS = [
  { key: 'olist', label: 'Olist ERP' },
  { key: 'sumup', label: 'SumUp' },
] as const

export default async function IntegracoesPage() {
  const supabase = await createServerSupabaseClient()

  const lastRuns = await Promise.all(
    INTEGRATIONS.map(async ({ key }) => {
      const { data } = await supabase
        .from('sync_runs')
        .select('status, finished_at')
        .eq('integration', key)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return { key, run: data }
    })
  )

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Saúde das Integrações</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {INTEGRATIONS.map(({ key, label }) => {
          const found = lastRuns.find((r) => r.key === key)
          return (
            <div key={key} className="rounded-lg border bg-white p-4">
              <h2 className="font-medium">{label}</h2>
              {found?.run ? (
                <p className="mt-1 text-sm text-neutral-600">
                  Última sincronização: {formatDateBR(found.run.finished_at ?? new Date())} —{' '}
                  {found.run.status}
                </p>
              ) : (
                <p className="mt-1 text-sm text-neutral-500">
                  Nenhuma sincronização registrada ainda.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
