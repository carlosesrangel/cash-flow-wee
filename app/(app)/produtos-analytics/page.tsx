'use client'

import { useState, useEffect } from 'react'
import { formatBRL } from '@/lib/format/currency'
import type { ProductRevenue } from '@/lib/analytics/engine'

export default function ProdutosAnalyticsPage() {
  const [products, setProducts] = useState<ProductRevenue[]>([])
  const [loading, setLoading] = useState(true)

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
    return <p className="text-sm text-neutral-500">Carregando produtos...</p>
  }

  const total = products.reduce((sum, p) => sum + p.total, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Análise de Produtos</h1>
        <p className="text-sm text-neutral-500">{products.length} produtos | Total: {formatBRL(total)}</p>
      </div>

      <div className="rounded-lg border bg-white">
        <div className="grid grid-cols-6 gap-4 border-b p-4 text-xs font-medium text-neutral-600">
          <div className="col-span-2">Produto</div>
          <div className="text-right">Receita</div>
          <div className="text-right">Vendas</div>
          <div className="text-right">Clientes</div>
          <div className="text-right">% Total</div>
        </div>
        <div className="divide-y">
          {products.map((p) => {
            const percentage = (p.total / total) * 100

            return (
              <div key={p.productId} className="grid grid-cols-6 gap-4 p-4 text-sm">
                <div className="col-span-2">
                  <div className="font-medium truncate">{p.productName}</div>
                  <div className="text-xs text-neutral-500">{p.productId.slice(0, 8)}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{formatBRL(p.total)}</div>
                  <div className="text-xs text-neutral-500">{formatBRL(p.realized)} realizado</div>
                </div>
                <div className="text-right">{p.invoiceCount}</div>
                <div className="text-right">{p.uniqueCustomers}</div>
                <div className="text-right">
                  <div className="font-bold">{percentage.toFixed(1)}%</div>
                  <div
                    className="mt-1 h-2 w-full rounded bg-neutral-200"
                    style={{
                      background: `linear-gradient(to right, rgb(59, 130, 246) ${percentage}%, rgb(229, 231, 235) ${percentage}%)`,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
