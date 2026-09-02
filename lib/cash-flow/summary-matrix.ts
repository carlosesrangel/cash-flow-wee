import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import { formatBRL } from '@/lib/format/currency'

export type SummaryDetail = {
  direction: 'entrada' | 'saida'
  date: string
  amount: number
  label: string
  customer?: string | null
  supplier?: string | null
  product?: string | null
  installment?: string | null
  paymentMethod?: string | null
  document?: string | null
}

export type SummaryMatrix = {
  columns: string[]
  rows: Array<{ label: string; values: number[]; total: number; details: SummaryDetail[][] }>
  totalSaidas: number[]
  fluxoLiquido: number[]
}

export type SummaryLedgerRow = {
  event_date: string
  amount: number
  direction: 'entrada' | 'saida'
  nature: string
  status: string
  metadata: Record<string, unknown> | null
  description: string | null
}

function category(row: SummaryLedgerRow): string {
  const metadataCategory = row.metadata?.categoria
  if (typeof metadataCategory === 'string' && metadataCategory.trim()) return metadataCategory.trim()
  if (row.nature === 'PROJECTED_CMV') return 'CMV'
  if (row.nature.includes('TAX') || row.nature.includes('SIMPLES')) return 'Impostos'
  if (row.nature.includes('AP')) return 'Sem categoria'
  return row.nature === 'MANUAL_ENTRY' ? 'Sem categoria' : 'Outras saídas'
}

function detail(row: SummaryLedgerRow): SummaryDetail {
  const metadata = row.metadata ?? {}
  return {
    direction: row.direction,
    date: row.event_date,
    amount: Number(row.amount) || 0,
    label: row.status === 'projected' && row.direction === 'entrada' ? 'Entrada projetada' : row.description ?? category(row),
    customer: (metadata.cliente as string | null) ?? null,
    supplier: (metadata.fornecedor as string | null) ?? null,
    product: (metadata.produto as string | null) ?? null,
    installment: (metadata.parcela as string | null) ?? null,
    paymentMethod: (metadata.forma_pagamento as string | null) ?? null,
    document: (metadata.documento as string | null) ?? null,
  }
}

export function buildSummaryMatrix(rows: SummaryLedgerRow[], period: 'month' | 'year', selected: string): SummaryMatrix {
  const columns = period === 'month' ? Array.from({ length: new Date(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)), 0).getDate() }, (_, i) => String(i + 1).padStart(2, '0')) : ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const indexFor = (date: string) => period === 'month' ? Number(date.slice(8, 10)) - 1 : Number(date.slice(5, 7)) - 1
  const actualRows = rows.filter((row) => row.event_date.startsWith(selected))
  const entries = new Map<string, { values: number[]; details: SummaryDetail[][] }>()
  const incoming = { values: Array(columns.length).fill(0), details: Array.from({ length: columns.length }, () => []) as SummaryDetail[][] }
  for (const row of actualRows) {
    const index = indexFor(row.event_date)
    if (index < 0 || index >= columns.length) continue
    const target = row.direction === 'entrada' ? incoming : (() => {
      const key = category(row)
      const existing = entries.get(key) ?? { values: Array(columns.length).fill(0), details: Array.from({ length: columns.length }, () => []) as SummaryDetail[][] }
      entries.set(key, existing)
      return existing
    })()
    target.values[index] += Number(row.amount) || 0
    target.details[index].push(detail(row))
  }
  const expenseRows = Array.from(entries.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, ...value, total: value.values.reduce((sum, amount) => sum + amount, 0) }))
  const totalSaidas = columns.map((_, index) => expenseRows.reduce((sum, row) => sum + row.values[index], 0))
  return { columns, rows: [{ label: 'Entradas', ...incoming, total: incoming.values.reduce((sum, amount) => sum + amount, 0) }, ...expenseRows], totalSaidas, fluxoLiquido: columns.map((_, index) => incoming.values[index] - totalSaidas[index]) }
}

export async function loadSummaryMatrix(orgId: string, period: 'month' | 'year', selected: string, suppliedClient?: { from: (table: string) => any }) {
  const admin = suppliedClient ?? createAdminSupabaseClient()
  const start = period === 'month' ? `${selected}-01` : `${selected}-01-01`
  const end = period === 'month' ? `${selected}-${String(new Date(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)), 0).getDate()).padStart(2, '0')}` : `${selected}-12-31`
  const rows = await fetchAllPages<SummaryLedgerRow>((from, to) => admin.from('financial_ledger').select('event_date, amount, direction, nature, status, metadata, description').eq('org_id', orgId).is('superseded_at', null).gte('event_date', start).lte('event_date', end).range(from, to), 'Falha ao carregar resumo do fluxo de caixa')
  return buildSummaryMatrix(rows, period, selected)
}

export function formatSummaryComposition(details: SummaryDetail[]) {
  return details.map((item) => `${item.label} · ${formatBRL(item.amount)}`).join('\n')
}
