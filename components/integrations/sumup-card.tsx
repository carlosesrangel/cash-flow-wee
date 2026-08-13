'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  status: 'configurado' | 'erro_configuracao'
  canManage: boolean
}

const STATUS_LABEL: Record<Props['status'], string> = {
  configurado: 'Configurado',
  erro_configuracao: 'Erro de configuração',
}

export function SumupCard({ status, canManage }: Props) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      const response = await fetch('/api/integracoes/sumup/sync', { method: 'POST' })
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

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="font-medium">SumUp</h2>
      <p className="mt-1 text-sm text-neutral-600">Status: {STATUS_LABEL[status]}</p>
      {canManage ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSync}
            disabled={syncing || status === 'erro_configuracao'}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>
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
