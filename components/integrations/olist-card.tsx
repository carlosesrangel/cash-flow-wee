'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateBR } from '@/lib/format/date'

type Props = {
  status: 'desconectado' | 'conectado' | 'precisa_reautorizar'
  connectedAt: string | null
}

const STATUS_LABEL: Record<Props['status'], string> = {
  desconectado: 'Desconectado',
  conectado: 'Conectado',
  precisa_reautorizar: 'Precisa reautorizar',
}

export function OlistCard({ status, connectedAt }: Props) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      const response = await fetch('/api/integracoes/olist/sync', { method: 'POST' })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        setSyncError(data.error ?? 'Falha ao sincronizar')
      } else {
        router.refresh()
      }
    } catch {
      setSyncError('Falha ao sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  const needsConnect = status === 'desconectado' || status === 'precisa_reautorizar'

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="font-medium">Olist ERP</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Status: {STATUS_LABEL[status]}
        {connectedAt && status === 'conectado' && ` — conectado em ${formatDateBR(connectedAt)}`}
      </p>
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
      {syncError && <p className="mt-2 text-sm text-red-600">{syncError}</p>}
    </div>
  )
}
