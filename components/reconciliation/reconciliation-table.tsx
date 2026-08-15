'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBRL } from '@/lib/format/currency'
import { formatDateBR } from '@/lib/format/date'

export type MatchStatus =
  | 'reconciliado_automaticamente'
  | 'reconciliado_manualmente'
  | 'nao_reconciliado'
  | 'conflito'
  | 'rejeitado_manualmente'

type MatchReasonCandidate = {
  sumupTransactionEventId: string
  valorBrutoSumupEstimado: number
  dataVencimentoSumup: string
}

export type MatchRow = {
  id: string
  status: MatchStatus
  candidate_ids: string[]
  match_reason: { candidatos?: MatchReasonCandidate[] } | null
  olist_accounts_receivable: {
    historico: string | null
    numero_documento: string | null
    valor: number | null
    data_vencimento: string | null
  } | null
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  reconciliado_automaticamente: 'Reconciliado (automático)',
  reconciliado_manualmente: 'Reconciliado (manual)',
  nao_reconciliado: 'Não reconciliado',
  conflito: 'Conflito',
  rejeitado_manualmente: 'Rejeitado manualmente',
}

function candidateLabel(candidateId: string, matchReason: MatchRow['match_reason']): string {
  const detail = matchReason?.candidatos?.find((c) => c.sumupTransactionEventId === candidateId)
  if (!detail) return candidateId.slice(0, 8)
  return `${formatBRL(detail.valorBrutoSumupEstimado)} · ${formatDateBR(detail.dataVencimentoSumup)}`
}

const RESOLVED_STATUSES: MatchStatus[] = ['reconciliado_automaticamente', 'reconciliado_manualmente']

export function ReconciliationTable({ matches, canManage }: { matches: MatchRow[]; canManage: boolean }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function confirmCandidate(matchId: string, sumupTransactionEventId: string) {
    setPendingId(matchId)
    setError(null)
    try {
      const response = await fetch(`/api/reconciliacao/${matchId}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sumupTransactionEventId }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        setError(data.error ?? 'Falha ao confirmar')
      } else {
        router.refresh()
      }
    } catch {
      setError('Falha ao confirmar')
    } finally {
      setPendingId(null)
    }
  }

  async function undoMatch(matchId: string) {
    setPendingId(matchId)
    setError(null)
    try {
      const response = await fetch(`/api/reconciliacao/${matchId}/desfazer`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        setError(data.error ?? 'Falha ao desfazer')
      } else {
        router.refresh()
      }
    } catch {
      setError('Falha ao desfazer')
    } finally {
      setPendingId(null)
    }
  }

  if (matches.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhuma parcela para reconciliar ainda.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-medium">Parcela</th>
            <th className="px-3 py-2 font-medium">Vencimento</th>
            <th className="px-3 py-2 font-medium">Valor</th>
            <th className="px-3 py-2 font-medium">Status</th>
            {canManage && <th className="px-3 py-2 font-medium">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => {
            const ar = match.olist_accounts_receivable
            return (
              <tr key={match.id} className="border-b last:border-0">
                <td className="px-3 py-2">{ar?.numero_documento ?? ar?.historico ?? '—'}</td>
                <td className="px-3 py-2">{ar?.data_vencimento ? formatDateBR(ar.data_vencimento) : '—'}</td>
                <td className="px-3 py-2">{ar?.valor != null ? formatBRL(ar.valor) : '—'}</td>
                <td className="px-3 py-2">{STATUS_LABEL[match.status]}</td>
                {canManage && (
                  <td className="px-3 py-2">
                    {match.status === 'conflito' && (
                      <div className="flex flex-wrap gap-1">
                        {match.candidate_ids.map((candidateId) => (
                          <button
                            key={candidateId}
                            onClick={() => confirmCandidate(match.id, candidateId)}
                            disabled={pendingId === match.id}
                            className="rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Confirmar {candidateLabel(candidateId, match.match_reason)}
                          </button>
                        ))}
                      </div>
                    )}
                    {RESOLVED_STATUSES.includes(match.status) && (
                      <button
                        onClick={() => undoMatch(match.id)}
                        disabled={pendingId === match.id}
                        className="rounded border px-2 py-1 text-xs font-medium disabled:opacity-50"
                      >
                        Desfazer
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
