'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import type { ProductRevenue } from '@/lib/analytics/engine'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { MetricCard } from '@/components/ui/metric-card'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangeFilter, type DateRange } from '@/components/analytics/date-range-filter'
import { Package } from 'lucide-react'

type ProductSort = 'units' | 'revenue'

function currentMonthRange(): DateRange {
  const endDate = new Date()
  const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
  return { startDate, endDate, days: endDate.getDate() }
}

export default function ProdutosPage() {
  const [products, setProducts] = useState<ProductRevenue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<ProductSort>('units')
  const [dateRange, setDateRange] = useState<DateRange>(currentMonthRange)

  useEffect(() => {
    void loadProducts(dateRange)
  }, [dateRange])

  async function loadProducts(range: DateRange) {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        startDate: range.startDate.toISOString(),
        endDate: range.endDate.toISOString(),
      })
      const response = await fetch(`/api/analytics/products?${params}`)
      if (!response.ok) throw new Error('Não foi possível carregar os produtos')
      const data = await response.json()
      setProducts(data.products || [])
    } catch {
      setProducts([])
      setError('Não foi possível carregar os produtos para este período.')
    } finally {
      setLoading(false)
    }
  }

  const sorted = useMemo(() => [...products].sort((a, b) => {
    if (sortBy === 'revenue') return b.total - a.total
    return b.unitsSold - a.unitsSold
  }), [products, sortBy])

  const totalRevenue = products.reduce((sum, product) => sum + product.total, 0)
  const totalUnits = products.reduce((sum, product) => sum + product.unitsSold, 0)
  const avgPrice = totalUnits > 0 ? totalRevenue / totalUnits : 0

  if (loading) {
    return <div className="space-y-6"><PageHeader title="Produtos" /><Card><CardContent className="pt-6"><Skeleton className="h-64" /></CardContent></Card></div>
  }

  if (error) {
    return <div className="space-y-6"><PageHeader title="Produtos" description={error} /><Card><CardContent className="pt-6 text-sm text-muted-foreground">Tente novamente selecionando o período.</CardContent></Card></div>
  }

  if (products.length === 0) {
    return <div className="space-y-6"><PageHeader title="Produtos" description="Não há dados de produtos disponíveis neste período" /><DateRangeFilter onRangeChange={setDateRange} loading={loading} /><EmptyState icon={<Package size={40} />} title="Nenhum produto" description="Sincronize os dados da Olist ou altere o período" /></div>
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Produtos" description="Ranking de produtos por período de venda" />
      <DateRangeFilter onRangeChange={setDateRange} loading={loading} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Receita Total" value={formatBRL(totalRevenue)} accentColor="navy" />
        <MetricCard label="Produtos" value={products.length.toString()} accentColor="navy" />
        <MetricCard label="Peças vendidas" value={totalUnits.toString()} accentColor="navy" />
        <MetricCard label="Preço Médio" value={formatBRL(avgPrice)} accentColor="navy" />
      </div>

      <Card><CardContent className="pt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Ranking de produtos</h2><p className="text-sm text-muted-foreground">{sorted.length} produtos no período</p></div><div className="flex gap-2"><button type="button" onClick={() => setSortBy('units')} className={`rounded-sm px-3 py-1.5 text-sm font-medium ${sortBy === 'units' ? 'bg-primary text-primary-foreground' : 'border border-border bg-muted text-muted-foreground'}`}>Peças vendidas</button><button type="button" onClick={() => setSortBy('revenue')} className={`rounded-sm px-3 py-1.5 text-sm font-medium ${sortBy === 'revenue' ? 'bg-primary text-primary-foreground' : 'border border-border bg-muted text-muted-foreground'}`}>Receita</button></div></div>
        <div className="hidden overflow-x-auto rounded-lg border md:block"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/50 text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Posição</th><th className="px-4 py-3 font-medium">Produto</th><th className="px-4 py-3 font-medium">SKU</th><th className="px-4 py-3 text-right font-medium">Peças vendidas</th><th className="px-4 py-3 text-right font-medium">Receita</th><th className="px-4 py-3 text-right font-medium">Pedidos</th></tr></thead><tbody>{sorted.map((product, index) => <tr key={product.productId} className="border-b last:border-0 hover:bg-muted/50"><td className="px-4 py-3 font-semibold">{index + 1}</td><td className="px-4 py-3"><div className="font-medium">{product.productName}</div><div className="text-xs text-muted-foreground">{product.productId}</div></td><td className="px-4 py-3 text-muted-foreground">{product.sku ?? '—'}</td><td className="px-4 py-3 text-right font-semibold">{product.unitsSold}</td><td className="px-4 py-3 text-right font-mono">{formatBRL(product.total)}</td><td className="px-4 py-3 text-right">{product.invoiceCount}</td></tr>)}</tbody></table></div>
        <div className="space-y-3 md:hidden">{sorted.map((product, index) => <div key={product.productId} className="rounded-lg border bg-muted/30 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">#{index + 1} · {product.productName}</p><p className="text-xs text-muted-foreground">SKU: {product.sku ?? '—'}</p></div><p className="font-mono font-semibold">{formatBRL(product.total)}</p></div><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{product.unitsSold} peças</span><span>{product.invoiceCount} pedidos</span></div></div>)}</div>
      </CardContent></Card>
    </div>
  )
}
