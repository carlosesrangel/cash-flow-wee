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
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center">
        <p className="text-lg text-slate-600">Carregando analytics...</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center">
        <p className="text-lg text-slate-600">Erro ao carregar dados.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <div className="space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="space-y-2 mb-10">
            <h1 className="text-4xl font-bold text-slate-900 tracking-tight">Análise de Vendas</h1>
            <p className="text-lg text-slate-600">Últimos 90 dias: receita, clientes e produtos</p>
          </div>

          {/* KPI Summary */}
          <div className="mb-10">
            <SalesSummaryCard summary={data.summary} />
          </div>

          {/* Revenue Trend & Monthly */}
          <div className="grid gap-6 lg:grid-cols-2 mb-8">
            <div className="rounded-xl border-2 border-slate-200 bg-white p-8 shadow-sm">
              <RevenueTrendList data={data.timeSeries} />
            </div>
            <div className="rounded-xl border-2 border-slate-200 bg-white p-8 shadow-sm">
              <MonthlyRevenueCard data={data.monthly} />
            </div>
          </div>

          {/* Customers & Products */}
          <div className="grid gap-6 lg:grid-cols-2 mb-8">
            <div className="rounded-xl border-2 border-slate-200 bg-white p-8 shadow-sm">
              <TopCustomersCard customers={data.topCustomers} />
            </div>
            <div className="rounded-xl border-2 border-slate-200 bg-white p-8 shadow-sm">
              <ProductsRevenueCard products={data.products} />
            </div>
          </div>

          {/* Variance */}
          <div className="rounded-xl border-2 border-slate-200 bg-white p-8 shadow-sm">
            <VarianceCard data={data.variance} />
          </div>
        </div>
      </div>
    </div>
  )
}
