'use client'

import { useState, useEffect, useMemo } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { CustomerMetric } from '@/lib/analytics/engine'
import { calculateRFVScore, getRFVSegmentBadge, type RFVScore } from '@/lib/analytics/rfv'
import { matchesRFVFilters, RECENCY_FILTERS, FREQUENCY_FILTERS, VALUE_FILTERS, type RFVFilterState } from '@/lib/analytics/rfv-filters'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { MetricCard } from '@/components/ui/metric-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Users } from 'lucide-react'

export default function ClientesPage() {
  const [customers, setCustomers] = useState<CustomerMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'ltv' | 'orders' | 'recent'>('ltv')
  const [rfvFilters, setRfvFilters] = useState<RFVFilterState>({})
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [customerDetail, setCustomerDetail] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    loadCustomers()
  }, [])

  async function loadCustomers() {
    try {
      const res = await fetch('/api/analytics/customers')
      const data = await res.json()
      setCustomers(data.allMetrics || [])
    } catch {
      // Silently fail and show empty state
    } finally {
      setLoading(false)
    }
  }

  async function openCustomer(customerId: string) {
    if (customerId === 'null') return
    setSelectedCustomerId(customerId)
    setDetailLoading(true)
    try {
      const response = await fetch(`/api/analytics/customers/${customerId}`)
      setCustomerDetail(response.ok ? await response.json() : null)
    } finally {
      setDetailLoading(false)
    }
  }

  // Calculate RFV scores for all customers (must be before any early returns)
  const customersWithRFV = useMemo(() => {
    const allValues = customers.map((c) => c.lifetimeValue)
    return customers.map((c) => ({
      ...c,
      rfv: calculateRFVScore(
        c.daysSinceLastOrder ?? undefined,
        c.orderCount,
        c.lifetimeValue,
        allValues
      ),
    }))
  }, [customers])

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Clientes" />
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-64" />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Filter by RFV segment if selected
  const filtered = customersWithRFV.filter((c) => matchesRFVFilters({ segment: c.rfv.rfvSegment, daysSinceLastOrder: c.daysSinceLastOrder ?? undefined, orderCount: c.orderCount, lifetimeValue: c.lifetimeValue }, rfvFilters))

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'ltv') return b.lifetimeValue - a.lifetimeValue
    if (sortBy === 'orders') return b.orderCount - a.orderCount
    if (sortBy === 'recent') return (b.lastOrderDate || '').localeCompare(a.lastOrderDate || '')
    return 0
  })

  const totalLTV = customers.reduce((sum, c) => sum + c.lifetimeValue, 0)
  const totalOrders = customers.reduce((sum, c) => sum + c.orderCount, 0)
  const avgOrderValue = totalOrders > 0 ? totalLTV / totalOrders : 0

  if (customers.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Clientes" description="Não há dados de clientes disponíveis" />
        <EmptyState icon={<Users size={40} />} title="Nenhum cliente" description="Sincronize os dados da Olist para ver clientes" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Análise de clientes com segmentação RFV"
      />

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard
          label="Clientes Totais"
          value={customers.length.toString()}
          accentColor="navy"
        />
        <MetricCard
          label="Valor Total (LTV)"
          value={formatBRL(totalLTV)}
          accentColor="navy"
        />
        <MetricCard
          label="LTV médio por cliente"
          value={formatBRL(customers.length > 0 ? totalLTV / customers.length : 0)}
          accentColor="navy"
        />
        <MetricCard
          label="Pedidos"
          value={totalOrders.toString()}
          accentColor="navy"
        />
        <MetricCard
          label="Ticket Médio"
          value={formatBRL(avgOrderValue)}
          accentColor="navy"
        />
      </div>

      {/* Customer List */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* RFV Filter buttons */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-neutral-600">Segmentação RFV</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setRfvFilters((previous) => ({ ...previous, segment: undefined }))}
                  className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                    !rfvFilters.segment
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  Todos
                </button>
                {(['Champions', 'Loyalists', 'At Risk', 'Need Attention', 'New', 'Dormant'] as const).map(
                  (segment) => {
                    const config = getRFVSegmentBadge(segment)
                    return (
                      <button
                        key={segment}
                        onClick={() => setRfvFilters((previous) => ({ ...previous, segment }))}
                        className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                          rfvFilters.segment === segment
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {config.emoji} {segment}
                      </button>
                    )
                  }
                )}
              </div>
            </div>

            <div className="grid gap-3 border-t pt-4 md:grid-cols-3" aria-label="Filtros cumulativos RFV">
              <RFVSelect label="Recência" value={rfvFilters.recency} options={RECENCY_FILTERS} onChange={(value) => setRfvFilters((previous) => ({ ...previous, recency: value || undefined }))} />
              <RFVSelect label="Frequência" value={rfvFilters.frequency} options={FREQUENCY_FILTERS} onChange={(value) => setRfvFilters((previous) => ({ ...previous, frequency: value || undefined }))} />
              <RFVSelect label="Valor acumulado" value={rfvFilters.value} options={VALUE_FILTERS} onChange={(value) => setRfvFilters((previous) => ({ ...previous, value: value || undefined }))} />
            </div>

            {/* Sort buttons */}
            <div className="flex flex-wrap gap-2">
              {(['ltv', 'orders', 'recent'] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSortBy(opt)}
                  className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                    sortBy === opt
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {opt === 'ltv' ? 'Valor Total' : opt === 'orders' ? 'Pedidos' : 'Recente'}
                </button>
              ))}
            </div>

            {/* Desktop grid view */}
            <div className="hidden md:block overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">RFV</th>
                    <th className="px-4 py-3 font-medium text-right">Valor Total</th>
                    <th className="px-4 py-3 font-medium text-right">LTV</th>
                    <th className="px-4 py-3 font-medium text-right">Pedidos</th>
                    <th className="px-4 py-3 font-medium text-right">Ticket Médio</th>
                    <th className="px-4 py-3 font-medium">Última Venda</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => {
                    const config = getRFVSegmentBadge(c.rfv.rfvSegment)
                    return (
                      <tr key={c.customerId} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => void openCustomer(c.customerId)} className="text-left hover:underline">
                          <div className="font-medium text-foreground">{c.customerName}</div>
                          <div className="text-xs text-muted-foreground">{c.customerId.slice(0, 8)}</div>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${config.bgColor} ${config.textColor}`}>
                            {config.emoji} {c.rfv.rfvSegment}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">{formatBRL(c.lifetimeValue)}</td>
                        <td className="px-4 py-3 text-right">
                          {formatBRL(c.lifetimeValue)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="secondary" className="text-xs">{c.orderCount}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{formatBRL(c.avgOrderValue)}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {c.lastOrderDate ? formatDateOnlyBR(c.lastOrderDate) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card view */}
            <div className="md:hidden space-y-3">
              {sorted.map((c) => {
                const config = getRFVSegmentBadge(c.rfv.rfvSegment)
                return (
                  <div key={c.customerId} className="rounded-lg border border-border bg-muted/30 p-3">
                    <button type="button" onClick={() => void openCustomer(c.customerId)} className="w-full text-left"><div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{c.customerName}</p>
                        <p className="text-xs text-muted-foreground">{c.customerId.slice(0, 8)}</p>
                      </div>
                      <p className="font-mono font-semibold text-foreground whitespace-nowrap">{formatBRL(c.lifetimeValue)}</p>
                    </div></button>
                    <div className="mb-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${config.bgColor} ${config.textColor}`}>
                        {config.emoji} {c.rfv.rfvSegment}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{c.orderCount} pedidos • {formatBRL(c.avgOrderValue)} ticket</span>
                      {c.lastOrderDate && <span className="text-muted-foreground">{formatDateOnlyBR(c.lastOrderDate)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedCustomerId && <Card><CardContent className="pt-6">{detailLoading ? <Skeleton className="h-48" /> : customerDetail ? <div className="space-y-4"><div className="flex items-start justify-between"><div><h2 className="text-lg font-semibold">Detalhe do cliente</h2><p className="text-sm text-muted-foreground">{customerDetail.contact?.email || 'Contato sem e-mail'} · {customerDetail.contact?.telefone || customerDetail.contact?.celular || 'Telefone não informado'}</p></div><button type="button" onClick={() => { setSelectedCustomerId(null); setCustomerDetail(null) }} className="text-sm text-muted-foreground hover:text-foreground">Fechar</button></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><MetricCard label="Valor total comprado (LTV)" value={formatBRL(customerDetail.summary.revenue)} /><MetricCard label="LTV médio" value={formatBRL(customerDetail.summary.averageOrderValue)} /><MetricCard label="Pedidos" value={customerDetail.summary.orders} /><MetricCard label="Ticket médio" value={formatBRL(customerDetail.summary.averageOrderValue)} /><MetricCard label="Primeira compra" value={customerDetail.summary.firstOrderDate ? formatDateOnlyBR(customerDetail.summary.firstOrderDate) : '—'} /><MetricCard label="Última compra" value={customerDetail.summary.lastOrderDate ? formatDateOnlyBR(customerDetail.summary.lastOrderDate) : '—'} /></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b"><tr><th className="py-2">Data</th><th className="py-2">Pedido</th><th className="py-2">Produto</th><th className="py-2">SKU</th><th className="py-2 text-right">Qtd.</th><th className="py-2 text-right">Valor unitário</th><th className="py-2 text-right">Valor total</th><th className="py-2">Status</th></tr></thead><tbody>{customerDetail.history.map((item: any, index: number) => <tr key={`${item.pedido}-${index}`} className="border-b last:border-0"><td className="py-2">{item.data ? formatDateOnlyBR(item.data) : '—'}</td><td className="py-2">{item.pedido ?? '—'}</td><td className="py-2">{item.produto ?? '—'}</td><td className="py-2">{item.sku ?? '—'}</td><td className="py-2 text-right">{item.quantidade ?? '—'}</td><td className="py-2 text-right font-mono">{formatBRL(item.valorUnitario)}</td><td className="py-2 text-right font-mono">{formatBRL(item.valorTotal)}</td><td className="py-2">{item.status ?? '—'}</td></tr>)}</tbody></table></div></div> : <p className="text-sm text-muted-foreground">Não foi possível carregar o detalhe.</p>}</CardContent></Card>}
    </div>
  )
}

function RFVSelect({ label, value, options, onChange }: { label: string; value?: string; options: readonly (readonly [string, string, number, number])[]; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-sm font-medium"><span>{label}</span><select value={value ?? ''} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"><option value="">Todos</option>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
}
