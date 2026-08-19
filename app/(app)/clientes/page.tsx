'use client'

import { useState, useEffect } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { CustomerMetric } from '@/lib/analytics/engine'
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

  useEffect(() => {
    loadCustomers()
  }, [])

  async function loadCustomers() {
    try {
      const res = await fetch('/api/analytics/customers')
      const data = await res.json()
      setCustomers(data.allMetrics || [])
    } catch (error) {
      console.error('Failed to load customers:', error)
    } finally {
      setLoading(false)
    }
  }

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

  const sorted = [...customers].sort((a, b) => {
    if (sortBy === 'ltv') return b.lifetimeValue - a.lifetimeValue
    if (sortBy === 'orders') return b.orderCount - a.orderCount
    if (sortBy === 'recent') return (b.lastOrderDate || '').localeCompare(a.lastOrderDate || '')
    return 0
  })

  const totalLTV = customers.reduce((sum, c) => sum + c.lifetimeValue, 0)
  const totalOrders = customers.reduce((sum, c) => sum + c.orderCount, 0)
  const avgOrderValue = customers.length > 0 ? totalLTV / totalOrders : 0

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
        description="Últimos 90 dias: clientes, compras e valor de vida"
      />

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
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
                    <th className="px-4 py-3 font-medium text-right">Valor Total</th>
                    <th className="px-4 py-3 font-medium text-right">Pedidos</th>
                    <th className="px-4 py-3 font-medium text-right">Ticket Médio</th>
                    <th className="px-4 py-3 font-medium">Última Venda</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => (
                    <tr key={c.customerId} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{c.customerName}</div>
                        <div className="text-xs text-muted-foreground">{c.customerId.slice(0, 8)}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">{formatBRL(c.lifetimeValue)}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge variant="secondary" className="text-xs">{c.orderCount}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{formatBRL(c.avgOrderValue)}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {c.lastOrderDate ? formatDateOnlyBR(c.lastOrderDate) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card view */}
            <div className="md:hidden space-y-3">
              {sorted.map((c) => (
                <div key={c.customerId} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{c.customerName}</p>
                      <p className="text-xs text-muted-foreground">{c.customerId.slice(0, 8)}</p>
                    </div>
                    <p className="font-mono font-semibold text-foreground whitespace-nowrap">{formatBRL(c.lifetimeValue)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{c.orderCount} pedidos • {formatBRL(c.avgOrderValue)} ticket</span>
                    {c.lastOrderDate && <span className="text-muted-foreground">{formatDateOnlyBR(c.lastOrderDate)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
