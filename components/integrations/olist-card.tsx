'use client'

import { useState } from 'react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateBR } from '@/lib/format/date'

type Props = {
  status: 'desconectado' | 'conectado' | 'precisa_reautorizar'
  connectedAt: string | null
  canManage: boolean
  lastSyncAt?: string | null
  lastSuccessfulSyncAt?: string | null
  orderCount?: number
  latestOrderNumber?: number | null
  latestOrderDate?: string | null
  latestOrderSyncedAt?: string | null
  lastSyncStatus?: 'success' | 'failed' | 'running' | null
  payableCategories?: { categorized: number; total: number; coveragePct: number }
  autoSync?: boolean
}

const STATUS_LABEL: Record<Props['status'], string> = {
  desconectado: 'Desconectado',
  conectado: 'Conectado',
  precisa_reautorizar: 'Autorização expirada',
}

export function OlistCard({
  status,
  connectedAt,
  canManage,
  lastSyncAt = null,
  lastSuccessfulSyncAt = null,
  orderCount = 0,
  latestOrderNumber = null,
  latestOrderDate = null,
  latestOrderSyncedAt = null,
  lastSyncStatus = null,
  payableCategories = { categorized: 0, total: 0, coveragePct: 100 },
  autoSync = false,
}: Props) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      const response = await fetch('/api/integracoes/olist/sync', { method: 'POST' })

      if (response.status === 504 || response.status === 502) {
        setSyncError(
          'A sincronização inicial (histórico completo) demora mais do que o servidor web permite. ' +
            'Rode `npm run sync:olist` localmente ou dispare o workflow "Sincronização Olist Diária" ' +
            'no GitHub Actions — ambos não têm esse limite de tempo.'
        )
        return
      }

      const data = await response.json()
      if (!response.ok || !data.ok) {
        setSyncError(data.error ?? 'Falha ao sincronizar')
      } else {
        if (autoSync) {
          await fetch('/api/integracoes/olist/payables/backfill', { method: 'POST' })
        }
        router.refresh()
      }
    } catch {
      setSyncError(
        'Falha ao sincronizar. Se esta é a primeira sincronização (histórico completo), ' +
          'rode `npm run sync:olist` localmente ou dispare o workflow no GitHub Actions em vez de usar este botão.'
      )
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (autoSync && canManage && status === 'conectado') {
      const timer = window.setTimeout(() => void handleSync(), 0)
      return () => window.clearTimeout(timer)
    }
    // The callback query is a one-shot trigger; the sync function itself is stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSync])

  const needsConnect = status === 'desconectado' || status === 'precisa_reautorizar'
  const syncLabel = lastSyncStatus === 'failed'
    ? 'Erro de sincronização'
    : lastSyncStatus === 'running'
      ? 'Sincronizando'
      : status === 'precisa_reautorizar'
        ? 'Autorização expirada'
        : STATUS_LABEL[status]

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="font-medium">Olist ERP</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Status: {syncLabel}
        {connectedAt && status === 'conectado' && ` — conectado em ${formatDateBR(connectedAt)}`}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Última sincronização: {lastSyncAt ? formatDateBR(lastSyncAt) : 'Nunca'}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Última sync válida: {lastSuccessfulSyncAt ? formatDateBR(lastSuccessfulSyncAt) : 'Nunca'}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Pedidos persistidos: {orderCount} · último pedido: {latestOrderNumber ?? '—'}{latestOrderDate ? ` (${formatDateBR(latestOrderDate)})` : ''}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Último registro atualizado no WEE: {latestOrderSyncedAt ? formatDateBR(latestOrderSyncedAt) : 'Nunca'}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        updated_at do fornecedor: indisponível na fonte persistida
      </p>
      {status === 'precisa_reautorizar' && (
        <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Integração requer reautorização. Os dados persistidos continuam disponíveis; novas sincronizações estão pausadas.
        </p>
      )}
      <p className="mt-1 text-xs text-neutral-500">
        Contas a pagar categorizadas: {payableCategories.categorized}/{payableCategories.total} ({payableCategories.coveragePct.toFixed(1)}%)
      </p>
      {payableCategories.coveragePct < 100 && payableCategories.total > 0 && (
        <p className="mt-1 text-xs text-amber-700">A cobertura será atualizada quando o detalhe da Olist estiver disponível.</p>
      )}
      {canManage ? (
        <div className="mt-3 flex gap-2">
          {needsConnect ? (
            <a
              href="/api/integracoes/olist/connect"
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              {status === 'precisa_reautorizar' ? 'Reconectar' : 'Conectar'}
            </a>
          ) : (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-neutral-500">
          Apenas administradores podem gerenciar esta integração.
        </p>
      )}
      {syncError && <p className="mt-2 text-sm text-red-600">{syncError}</p>}
    </div>
  )
}
