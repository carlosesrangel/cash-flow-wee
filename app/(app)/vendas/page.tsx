'use client'

import { useState, useEffect } from 'react'
import { SalesSummaryCard } from '@/components/analytics/sales-summary-card'
import { RevenueTrendList } from '@/components/analytics/revenue-trend-list'
import { TopCustomersCard } from '@/components/analytics/top-customers-card'
import { MonthlyRevenueCard } from '@/components/analytics/monthly-revenue-card'
import { ProductsRevenueCard } from '@/components/analytics/products-revenue-card'
import { VarianceCard } from '@/components/analytics/variance-card'
import type {
  DailyRevenuePoint,
  MonthlyRevenue,
  TopCustomer,
  RevenueVariance,
  SalesSummary,
} from '@/lib/analytics/engine'

type AnalyticsData = {
  timeSeries: DailyRevenuePoint[]
  monthly: MonthlyRevenue[]
  variance: RevenueVariance[]
  summary: SalesSummary
  topCustomers: TopCustomer[]
  products: any[]
}

export default function VendasPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAnalytics()
  }, [])

  async function loadAnalytics() {
    try {
      const [revenueRes, customersRes, productsRes] = await Promise.all([
        fetch('/api/analytics/revenue'),
        fetch('/api/analytics/customers'),
        fetch('/api/analytics/products'),
      ])

      const revenue = await revenueRes.json()
      const customers = await customersRes.json()
      const products = await productsRes.json()

      setData({
        ...revenue,
        topCustomers: customers.topCustomers,
        products: products.products,
      })
    } catch (error) {
      console.error('Failed to load analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Carregando analytics...</p>
  }

  if (!data) {
    return <p className="text-sm text-neutral-500">Erro ao carregar dados.</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Análise de Vendas</h1>
        <p className="text-sm text-neutral-500">Últimos 90 dias de receita, clientes e produtos</p>
      </div>

      <SalesSummaryCard summary={data.summary} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <RevenueTrendList data={data.timeSeries} />
        </div>
        <div>
          <MonthlyRevenueCard data={data.monthly} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TopCustomersCard customers={data.topCustomers} />
        <ProductsRevenueCard products={data.products} />
      </div>

      <VarianceCard data={data.variance} />
    </div>
  )
}
