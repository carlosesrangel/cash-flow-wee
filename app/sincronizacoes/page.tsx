import { createServerSupabaseClient } from '@/lib/supabase/server'
import Link from 'next/link'

interface SyncRun {
  id: string
  org_id: string
  integration: string
  status: 'running' | 'success' | 'failed'
  started_at: string
  finished_at: string | null
  records_received: number
  records_processed: number
  error_message: string | null
}

const STATUS_ICONS = {
  success: '✅',
  failed: '❌',
  running: '⏳',
}

const STATUS_COLORS = {
  success: 'bg-green-50 text-green-700 border-green-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  running: 'bg-blue-50 text-blue-700 border-blue-200',
}

export default async function SyncDashboard() {
  const supabase = await createServerSupabaseClient()

  // Buscar últimos 30 syncs
  const { data: syncs, error } = await supabase
    .from('sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(30)

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="rounded-lg bg-red-50 p-4 text-red-700">
          Erro ao carregar sincronizações: {error.message}
        </div>
      </div>
    )
  }

  // Agrupar por data
  const groupedBySyncType = (syncs || []).reduce((acc, sync) => {
    const key = sync.integration
    if (!acc[key]) acc[key] = []
    acc[key].push(sync as SyncRun)
    return acc
  }, {} as Record<string, SyncRun[]>)

  // Calcular estatísticas
  const stats = {
    olist: {
      total: groupedBySyncType['olist']?.length || 0,
      success: groupedBySyncType['olist']?.filter(s => s.status === 'success').length || 0,
      failed: groupedBySyncType['olist']?.filter(s => s.status === 'failed').length || 0,
    },
    sumup: {
      total: groupedBySyncType['sumup']?.length || 0,
      success: groupedBySyncType['sumup']?.filter(s => s.status === 'success').length || 0,
      failed: groupedBySyncType['sumup']?.filter(s => s.status === 'failed').length || 0,
    },
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-slate-900">📊 Monitoramento de Sincronizações</h1>
            <Link href="/" className="text-blue-600 hover:text-blue-700">
              ← Voltar
            </Link>
          </div>
          <p className="mt-2 text-slate-600">Histórico dos últimos 30 syncs de Olist e SumUp</p>
        </div>

        {/* Stats Cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Olist Stats */}
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">🏪 Olist</h2>
            <div className="space-y-2 text-sm">
              <p className="flex justify-between">
                <span className="text-slate-600">Total:</span>
                <span className="font-medium text-slate-900">{stats.olist.total}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-green-600">✅ Sucesso:</span>
                <span className="font-medium text-green-700">{stats.olist.success}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-red-600">❌ Falhas:</span>
                <span className="font-medium text-red-700">{stats.olist.failed}</span>
              </p>
              {stats.olist.total > 0 && (
                <p className="flex justify-between pt-2 text-xs text-slate-500">
                  <span>Taxa de sucesso:</span>
                  <span className="font-medium">
                    {Math.round((stats.olist.success / stats.olist.total) * 100)}%
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* SumUp Stats */}
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">💳 SumUp</h2>
            <div className="space-y-2 text-sm">
              <p className="flex justify-between">
                <span className="text-slate-600">Total:</span>
                <span className="font-medium text-slate-900">{stats.sumup.total}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-green-600">✅ Sucesso:</span>
                <span className="font-medium text-green-700">{stats.sumup.success}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-red-600">❌ Falhas:</span>
                <span className="font-medium text-red-700">{stats.sumup.failed}</span>
              </p>
              {stats.sumup.total > 0 && (
                <p className="flex justify-between pt-2 text-xs text-slate-500">
                  <span>Taxa de sucesso:</span>
                  <span className="font-medium">
                    {Math.round((stats.sumup.success / stats.sumup.total) * 100)}%
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Timeline de Syncs */}
        <div className="rounded-lg bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Histórico Detalhado</h2>
          </div>
          <div className="divide-y divide-slate-200">
            {(syncs || []).length === 0 ? (
              <div className="p-6 text-center text-slate-500">Nenhuma sincronização encontrada</div>
            ) : (
              (syncs || []).map((sync: SyncRun) => {
                const started = new Date(sync.started_at)
                const finished = sync.finished_at ? new Date(sync.finished_at) : null
                const duration = finished
                  ? Math.round((finished.getTime() - started.getTime()) / 1000)
                  : null

                const statusColor = STATUS_COLORS[sync.status as keyof typeof STATUS_COLORS]
                const statusIcon = STATUS_ICONS[sync.status as keyof typeof STATUS_ICONS]

                return (
                  <div key={sync.id} className="px-6 py-4 hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium border ${statusColor}`}>
                            {statusIcon} {sync.status}
                          </span>
                          <span className="text-sm font-medium text-slate-700">
                            {sync.integration === 'olist' ? '🏪 Olist' : '💳 SumUp'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600">
                          Org: <code className="bg-slate-100 px-2 py-1 rounded text-xs">{sync.org_id.substring(0, 8)}...</code>
                        </p>
                        <p className="text-xs text-slate-500 mt-2">
                          {started.toLocaleString('pt-BR', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                          {duration && ` • ${duration}s`}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm">
                          <p className="text-slate-600">
                            <span className="font-medium text-slate-900">{sync.records_received}</span> recebidos
                          </p>
                          <p className="text-slate-600">
                            <span className="font-medium text-slate-900">{sync.records_processed}</span> processados
                          </p>
                        </div>
                      </div>
                    </div>
                    {sync.error_message && (
                      <div className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700 border border-red-200">
                        <p className="font-medium">Erro:</p>
                        <p className="mt-1 text-xs break-words">{sync.error_message}</p>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-6 rounded-lg bg-blue-50 p-4 text-sm text-blue-700 border border-blue-200">
          <p className="font-medium">💡 Informação</p>
          <ul className="mt-2 space-y-1 text-xs ml-4">
            <li>• Olist: sincroniza diariamente às 23:00 (BRT) • SumUp: sincroniza diariamente às 00:00 (BRT)</li>
            <li>• Sincronizações incrementais: últimas 24h • Sincronizações iniciais: histórico completo</li>
            <li>• Você pode disparar manualmente via GitHub Actions → Actions → Sincronização [Olist/SumUp]</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
