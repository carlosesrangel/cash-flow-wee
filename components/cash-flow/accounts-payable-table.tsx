'use client'

import { useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { ClassifiedEntry } from '@/lib/cash-flow/classify'
import type { AgingBucket } from '@/lib/cash-flow/aging'
import type { PayableStatusResult } from '@/lib/payables/classify-status'
import { getPaidAmount } from '@/lib/payables/filters'
import { ArrowUpDown } from 'lucide-react'

export type AccountsPayableRow = {
  id: string
  numeroDocumento: string | null
  historico: string | null
  fornecedorNome: string | null
  valor: number | null
  saldo: number | null
  valorPago: number | null
  dataVencimento: string | null
  categoria: string | null
  payableStatus: PayableStatusResult
  classification: ClassifiedEntry
  agingBucket: AgingBucket | null
}

const EXCLUSION_REASON_LABEL: Record<Exclude<ClassifiedEntry, { included: true }>['reason'], string> = {
  cancelado: 'cancelado',
  situacao_desconhecida: 'situação desconhecida',
  dados_incompletos: 'dados incompletos',
}

type SortField = 'status' | 'fornecedor' | 'categoria' | 'vencimento' | 'valor' | 'saldo'
type SortDirection = 'asc' | 'desc'

const STATUS_DOT_CLASS: Record<PayableStatusResult['color'], string> = {
  gray: 'bg-neutral-400',
  red: 'bg-red-500',
  yellow: 'bg-amber-400',
  green: 'bg-emerald-500',
}

function StatusIndicator({ status }: { status: PayableStatusResult }) {
  return (
    <span className="inline-flex items-center gap-2" title={status.label} aria-label={`Status: ${status.label}`}>
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[status.color]}`} />
      <span>{status.label}</span>
    </span>
  )
}

export function AccountsPayableTable({ rows, today }: { rows: AccountsPayableRow[]; today: string }) {
  void today
  const [sortField, setSortField] = useState<SortField>('status')
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

  const excluded = rows.filter((row) => !row.classification.included)

  const sortedRows = [...rows].sort((a, b) => {
    let aVal: any
    let bVal: any

    switch (sortField) {
      case 'status':
        aVal = a.payableStatus.priority
        bVal = b.payableStatus.priority
        break
      case 'fornecedor':
        aVal = a.fornecedorNome || ''
        bVal = b.fornecedorNome || ''
        break
      case 'categoria':
        aVal = a.categoria || ''
        bVal = b.categoria || ''
        break
      case 'vencimento':
        aVal = a.dataVencimento || ''
        bVal = b.dataVencimento || ''
        break
      case 'valor':
        aVal = a.valor ?? 0
        bVal = b.valor ?? 0
        break
      case 'saldo':
        aVal = a.saldo ?? 0
        bVal = b.saldo ?? 0
        break
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
    const aDate = a.dataVencimento || ''
    const bDate = b.dataVencimento || ''
    return aDate.localeCompare(bDate)
  })

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma conta a pagar encontrada.</p>
  }

  return (
    <div className="space-y-4">
      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-3 font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('status')}>
                <div className="flex items-center gap-2">
                  Status
                  <SortIcon field="status" />
                </div>
              </th>
              <th className="px-3 py-3 font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('fornecedor')}>
                <div className="flex items-center gap-2">Fornecedor<SortIcon field="fornecedor" /></div>
              </th>
              <th className="px-3 py-3 font-medium">Histórico</th>
              <th className="px-3 py-3 font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('categoria')}>
                <div className="flex items-center gap-2">Categoria<SortIcon field="categoria" /></div>
              </th>
              <th className="px-3 py-3 font-medium">Nº documento</th>
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
              <th className="px-3 py-3 font-medium cursor-pointer hover:bg-muted text-right" onClick={() => handleSort('saldo')}>
                <div className="flex items-center justify-end gap-2">Saldo<SortIcon field="saldo" /></div>
              </th>
              <th className="px-3 py-3 font-medium text-right">Pago</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const paidAmount = getPaidAmount(row)
              return (
                <tr
                  key={row.id}
                  className="border-b last:border-0 transition-colors hover:bg-muted/50"
                >
                  <td className="px-3 py-3 font-medium"><StatusIndicator status={row.payableStatus} /></td>
                  <td className="px-3 py-3 font-medium text-foreground">
                    {row.fornecedorNome || row.numeroDocumento || row.historico || '—'}
                  </td>
                  <td className="px-3 py-3 max-w-64 truncate" title={row.historico ?? undefined}>{row.historico || '—'}</td>
                  <td className="px-3 py-3">{row.categoria || 'Sem categoria'}</td>
                  <td className="px-3 py-3">{row.numeroDocumento || '—'}</td>
                  <td className="px-3 py-3">{row.dataVencimento ? formatDateOnlyBR(row.dataVencimento) : '—'}</td>
                  <td className="px-3 py-3 text-right font-mono">{row.valor != null ? formatBRL(row.valor) : '—'}</td>
                  <td className="px-3 py-3 text-right font-mono">{row.saldo != null ? formatBRL(row.saldo) : '—'}</td>
                  <td className="px-3 py-3 text-right font-mono">{paidAmount != null ? formatBRL(paidAmount) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {sortedRows.map((row) => {
          const paidAmount = getPaidAmount(row)
          return (
            <div
              key={row.id}
              className="rounded-lg border border-border bg-card p-3 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {row.fornecedorNome || row.numeroDocumento || row.historico || '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">{row.dataVencimento ? formatDateOnlyBR(row.dataVencimento) : 'Sem vencimento'}</p>
                </div>
                <p className="font-mono font-semibold text-foreground whitespace-nowrap">
                  {row.valor != null ? formatBRL(row.valor) : '—'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <StatusIndicator status={row.payableStatus} />
                <span>{row.categoria || 'Sem categoria'}</span>
                <span>Saldo: {row.saldo != null ? formatBRL(row.saldo) : '—'}</span>
                <span>Pago: {paidAmount != null ? formatBRL(paidAmount) : '—'}</span>
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
