'use client'

import { useState, useEffect } from 'react'
import { formatBRL } from '@/lib/format/currency'
import type { ProductRevenue } from '@/lib/analytics/engine'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { MetricCard } from '@/components/ui/metric-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Package } from 'lucide-react'

export default function ProdutosPage() {
  const [products, setProducts] = useState<ProductRevenue[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'revenue' | 'sales' | 'customers'>('revenue')

  useEffect(() => {
    loadProducts()
  }, [])

  async function loadProducts() {
    try {
      const res = await fetch('/api/analytics/products')
      const data = await res.json()
      setProducts(data.products || [])
    } catch (error) {
      console.error('Failed to load products:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Produtos" />
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-64" />
          </CardContent>
        </Card>
      </div>
    )
  }

  const sorted = [...products].sort((a, b) => {
    if (sortBy === 'revenue') return b.total - a.total
    if (sortBy === 'sales') return b.invoiceCount - a.invoiceCount
    if (sortBy === 'customers') return b.uniqueCustomers - a.uniqueCustomers
    return 0
  })

  const totalRevenue = products.reduce((sum, p) => sum + p.total, 0)
  const totalSales = products.reduce((sum, p) => sum + p.invoiceCount, 0)
  const totalCustomers = products.reduce((sum, p) => sum + p.uniqueCustomers, 0)
  const avgPrice = totalSales > 0 ? totalRevenue / totalSales : 0

  if (products.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Produtos" description="Não há dados de produtos disponíveis" />
        <EmptyState icon={<Package size={40} />} title="Nenhum produto" description="Sincronize os dados da Olist para ver produtos" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produtos"
        description="Últimos 90 dias: receita, vendas e clientes por produto"
      />

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Receita Total"
          value={formatBRL(totalRevenue)}
          accentColor="#082d74"
        />
        <MetricCard
          label="Produtos"
          value={products.length.toString()}
          accentColor="#082d74"
        />
        <MetricCard
          label="Vendas"
          value={totalSales.toString()}
          accentColor="#082d74"
        />
        <MetricCard
          label="Preço Médio"
          value={formatBRL(avgPrice)}
          accentColor="#082d74"
        />
      </div>

      {/* Product List */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Sort buttons */}
            <div className="flex flex-wrap gap-2">
              {(['revenue', 'sales', 'customers'] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSortBy(opt)}
                  className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                    sortBy === opt
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {opt === 'revenue' ? 'Receita' : opt === 'sales' ? 'Vendas' : 'Clientes'}
                </button>
              ))}
            </div>

            {/* Desktop grid view */}
            <div className="hidden md:block overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Produto</th>
                    <th className="px-4 py-3 font-medium text-right">Receita Total</th>
                    <th className="px-4 py-3 font-medium text-right">Realizado</th>
                    <th className="px-4 py-3 font-medium text-right">Vendas</th>
                    <th className="px-4 py-3 font-medium text-right">Clientes</th>
                    <th className="px-4 py-3 font-medium text-right">% do Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => {
                    const percentage = totalRevenue > 0 ? (p.total / totalRevenue) * 100 : 0
                    return (
                      <tr key={p.productId} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{p.productName}</div>
                          <div className="text-xs text-muted-foreground">{p.productId.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">{formatBRL(p.total)}</td>
                        <td className="px-4 py-3 text-right text-sm text-muted-foreground">{formatBRL(p.realized)}</td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="secondary" className="text-xs">{p.invoiceCount}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="outline" className="text-xs">{p.uniqueCustomers}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-semibold text-foreground">{percentage.toFixed(1)}%</div>
                          <div className="mt-1 h-1.5 w-full rounded bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${percentage}%` }}
                            />
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
              {sorted.map((p) => {
                const percentage = totalRevenue > 0 ? (p.total / totalRevenue) * 100 : 0
                return (
                  <div key={p.productId} className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{p.productName}</p>
                        <p className="text-xs text-muted-foreground">{p.productId.slice(0, 8)}</p>
                      </div>
                      <p className="font-mono font-semibold text-foreground whitespace-nowrap">{formatBRL(p.total)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2 mb-2 text-xs">
                      <span className="text-muted-foreground">{p.invoiceCount} vendas • {p.uniqueCustomers} clientes</span>
                      <span className="font-semibold text-foreground">{percentage.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
