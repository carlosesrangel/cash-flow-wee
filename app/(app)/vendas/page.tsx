'use client'

import { useState, useEffect } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SalesSummaryCard } from '@/components/analytics/sales-summary-card'
import { RevenueTrendList } from '@/components/analytics/revenue-trend-list'
import { TopCustomersCard } from '@/components/analytics/top-customers-card'
import { MonthlyRevenueCard } from '@/components/analytics/monthly-revenue-card'
import { ProductsRevenueCard } from '@/components/analytics/products-revenue-card'
import { VarianceCard } from '@/components/analytics/variance-card'
import { DateRangeFilter, type DateRange } from '@/components/analytics/date-range-filter'
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
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 90)
    return { startDate: start, endDate: end, days: 90 }
  })

  useEffect(() => {
    loadAnalytics()
  }, [dateRange])

  async function loadAnalytics() {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        startDate: dateRange.startDate.toISOString(),
        endDate: dateRange.endDate.toISOString(),
      })

      const [revenueRes, customersRes, productsRes] = await Promise.all([
        fetch(`/api/analytics/revenue?${params}`),
        fetch(`/api/analytics/customers?${params}`),
        fetch(`/api/analytics/products?${params}`),
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
      // Error suppressed
    } finally {
      setLoading(false)
    }
  }

  function handleDateRangeChange(newRange: DateRange) {
    setDateRange(newRange)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Vendas" />
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-96" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Vendas" description="Não há dados de vendas disponíveis" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendas"
        description={`${dateRange.startDate.toLocaleDateString('pt-BR')} até ${dateRange.endDate.toLocaleDateString('pt-BR')}`}
      />

      <DateRangeFilter onRangeChange={handleDateRangeChange} loading={loading} />

      {loading ? (
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-24" />
          </CardContent>
        </Card>
      ) : (
        <SalesSummaryCard summary={data?.summary || { totalRevenue: 0, totalOrders: 0 }} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <RevenueTrendList data={data.timeSeries} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <MonthlyRevenueCard data={data.monthly} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <TopCustomersCard customers={data.topCustomers} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <ProductsRevenueCard products={data.products} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <VarianceCard data={data.variance} />
        </CardContent>
      </Card>
    </div>
  )
}
