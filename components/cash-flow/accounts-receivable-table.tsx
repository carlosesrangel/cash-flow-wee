'use client'

import { useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { ClassifiedEntry } from '@/lib/cash-flow/classify'
import { AGING_BUCKET_LABEL, type AgingBucket } from '@/lib/cash-flow/aging'
import { Badge } from '@/components/ui/badge'
import { ArrowUpDown } from 'lucide-react'

export type AccountsReceivableRow = {
  id: string
  numeroDocumento: string | null
  historico: string | null
  clienteNome: string | null
  valor: number | null
  dataVencimento?: string | null
  formaPagamento?: string | null
  parcela?: string | null
  classification: ClassifiedEntry
  agingBucket: AgingBucket | null
}

const EXCLUSION_REASON_LABEL: Record<Exclude<ClassifiedEntry, { included: true }>['reason'], string> = {
  cancelado: 'cancelado',
  situacao_desconhecida: 'situação desconhecida',
  dados_incompletos: 'dados incompletos',
}

const BUCKET_LABEL: Record<'realizado' | 'contratado', string> = {
  realizado: 'Realizado',
  contratado: 'Em aberto',
}

const getAgingBadgeVariant = (bucket: AgingBucket | null): 'destructive' | 'warning' | 'success' | 'default' => {
  if (!bucket) return 'default'
  switch (bucket) {
    case 'vencido':
      return 'destructive'
    case '0-7':
      return 'warning'
    case '8-15':
      return 'warning'
    default:
      return 'success'
  }
}

type SortField = 'cliente' | 'vencimento' | 'valor' | 'aging'
type SortDirection = 'asc' | 'desc'

export function AccountsReceivableTable({ rows, today }: { rows: AccountsReceivableRow[]; today: string }) {
  void today
  const [sortField, setSortField] = useState<SortField>('vencimento')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={14} className="opacity-40" />
    return <ArrowUpDown size={14} className={sortDirection === 'asc' ? 'rotate-180' : ''} />
  }

  const included = rows.filter((row) => row.classification.included)
  const excluded = rows.filter((row) => !row.classification.included)

  const sortedRows = [...included].sort((a, b) => {
    let aVal: any
    let bVal: any

    switch (sortField) {
      case 'cliente':
        aVal = a.clienteNome || ''
        bVal = b.clienteNome || ''
        break
      case 'vencimento':
        aVal = (a.classification as any).date || ''
        bVal = (b.classification as any).date || ''
        break
      case 'valor':
        aVal = a.valor ?? 0
        bVal = b.valor ?? 0
        break
      case 'aging':
        aVal = a.agingBucket || 'z'
        bVal = b.agingBucket || 'z'
        break
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma conta a receber encontrada.</p>
  }

  return (
    <div className="space-y-4">
      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('cliente')}>
                <div className="flex items-center gap-2">
                  Cliente
                  <SortIcon field="cliente" />
                </div>
              </th>
              <th className="px-3 py-3 font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('vencimento')}>
                <div className="flex items-center gap-2">
                  Vencimento
                  <SortIcon field="vencimento" />
                </div>
              </th>
              <th className="px-3 py-3 font-medium cursor-pointer hover:bg-muted text-right" onClick={() => handleSort('valor')}>
                <div className="flex items-center justify-end gap-2">
                  Valor
                  <SortIcon field="valor" />
                </div>
              </th>
              <th className="px-3 py-3 font-medium">Parcela</th>
              <th className="px-3 py-3 font-medium">Forma de pagamento</th>
              <th className="px-3 py-3 font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('aging')}>
                <div className="flex items-center gap-2">
                  Status
                  <SortIcon field="aging" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const classification = row.classification as { included: true; bucket: 'realizado' | 'contratado'; date: string }
              return (
                <tr
                  key={row.id}
                  className={`border-b last:border-0 transition-colors ${
                    row.agingBucket === 'vencido'
                      ? 'bg-destructive/5 hover:bg-destructive/10'
                      : row.agingBucket === '0-7'
                        ? 'bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-950/20 dark:hover:bg-yellow-900/30'
                        : 'hover:bg-muted/50'
                  }`}
                >
                  <td className="px-3 py-3 font-medium text-foreground">{row.clienteNome || '—'}</td>
                  <td className="px-3 py-3">{formatDateOnlyBR(classification.date)}</td>
                  <td className="px-3 py-3 text-right font-mono">{row.valor != null ? formatBRL(row.valor) : '—'}</td>
                  <td className="px-3 py-3">{row.parcela || '—'}</td>
                  <td className="px-3 py-3">{row.formaPagamento || '—'}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={classification.bucket === 'realizado' ? 'success' : 'secondary'}>{BUCKET_LABEL[classification.bucket]}</Badge>
                      {row.agingBucket && <Badge variant={getAgingBadgeVariant(row.agingBucket)}>{AGING_BUCKET_LABEL[row.agingBucket]}</Badge>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {sortedRows.map((row) => {
          const classification = row.classification as { included: true; bucket: 'realizado' | 'contratado'; date: string }
          return (
            <div
              key={row.id}
              className={`rounded-lg border p-3 transition-colors ${
                row.agingBucket === 'vencido'
                  ? 'bg-destructive/5 border-destructive/20'
                  : row.agingBucket === '0-7'
                    ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800'
                    : 'bg-card border-border'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{row.clienteNome || '—'}</p>
                  <p className="text-xs text-muted-foreground">{formatDateOnlyBR(classification.date)}</p>
                </div>
                <p className="font-mono font-semibold text-foreground whitespace-nowrap">
                  {row.valor != null ? formatBRL(row.valor) : '—'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={classification.bucket === 'realizado' ? 'success' : 'secondary'} className="text-xs">
                  {BUCKET_LABEL[classification.bucket]}
                </Badge>
                {row.agingBucket && (
                  <Badge variant={getAgingBadgeVariant(row.agingBucket)} className="text-xs">
                    {AGING_BUCKET_LABEL[row.agingBucket]}
                  </Badge>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Excluded rows */}
      {excluded.length > 0 && (
        <details className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            Fora do fluxo de caixa ({excluded.length})
          </summary>
          <ul className="mt-3 space-y-1">
            {excluded.map((row) => (
              <li key={row.id} className="text-xs text-muted-foreground">
                {row.numeroDocumento || row.historico || row.id} —{' '}
                {EXCLUSION_REASON_LABEL[(row.classification as { included: false; reason: keyof typeof EXCLUSION_REASON_LABEL }).reason]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
