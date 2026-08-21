'use client'

import { useState, useEffect } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import type { CustomerMetric } from '@/lib/analytics/engine'

export default function ClientesAnalyticsPage() {
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
      // Error suppressed
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Carregando clientes...</p>
  }

  const sorted = [...customers].sort((a, b) => {
    if (sortBy === 'ltv') return b.lifetimeValue - a.lifetimeValue
    if (sortBy === 'orders') return b.orderCount - a.orderCount
    if (sortBy === 'recent') return (b.lastOrderDate || '').localeCompare(a.lastOrderDate || '')
    return 0
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Análise de Clientes</h1>
        <p className="text-sm text-neutral-500">{customers.length} clientes encontrados</p>
      </div>

      <div className="flex gap-2">
        {(['ltv', 'orders', 'recent'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setSortBy(opt)}
            className={`rounded px-3 py-1 text-sm ${
              sortBy === opt ? 'border-blue-400 bg-blue-50' : 'border border-neutral-300'
            }`}
          >
            {opt === 'ltv' ? 'LTV' : opt === 'orders' ? 'Pedidos' : 'Recente'}
          </button>
        ))}
      </div>

      <div className="rounded-lg border bg-white">
        <div className="grid grid-cols-5 gap-4 border-b p-4 text-xs font-medium text-neutral-600">
          <div>Cliente</div>
          <div className="text-right">LTV</div>
          <div className="text-right">Pedidos</div>
          <div className="text-right">Ticket</div>
          <div className="text-right">Última Venda</div>
        </div>
        <div className="divide-y">
          {sorted.map((c) => (
            <div key={c.customerId} className="grid grid-cols-5 gap-4 p-4 text-sm">
              <div>
                <div className="font-medium">{c.customerName}</div>
                <div className="text-xs text-neutral-500">{c.customerId.slice(0, 8)}</div>
              </div>
              <div className="text-right">
                <div className="font-bold">{formatBRL(c.lifetimeValue)}</div>
              </div>
              <div className="text-right">{c.orderCount}</div>
              <div className="text-right">{formatBRL(c.avgOrderValue)}</div>
              <div className="text-right">
                <div>{c.lastOrderDate ? formatDateOnlyBR(c.lastOrderDate) : '-'}</div>
                {c.daysSinceLastOrder !== null && (
                  <div className="text-xs text-neutral-500">{c.daysSinceLastOrder}d atrás</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
