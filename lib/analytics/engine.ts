import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type DailyRevenuePoint = {
  date: string
  revenue: number
  transactions: number
  customers: number
}

export type MonthlyRevenue = {
  month: string
  realized: number
  pending: number
  total: number
  invoiceCount: number
  uniqueCustomers: number
}

export type CustomerMetric = {
  customerId: string
  customerName: string
  orderCount: number
  lifetimeValue: number
  avgOrderValue: number
  lastOrderDate: string | null
  firstOrderDate: string | null
  daysSinceLastOrder: number | null
  pendingAmount: number
}

export type ProductRevenue = {
  productId: string
  productName: string
  realized: number
  pending: number
  total: number
  invoiceCount: number
  uniqueCustomers: number
}

export type RevenueVariance = {
  month: string
  forecastTotal: number
  realizedTotal: number
  varianceAbsolute: number
  variancePercentage: number
}

export type TopCustomer = {
  rank: number
  customerId: string
  customerName: string
  lifetimeValue: number
  orderCount: number
  avgOrderValue: number
  revenuePercentage: number
}

export type SalesSummary = {
  totalRevenue: number
  monthlyRevenue: number
  topCustomersCount: number
  productCount: number
  averageOrderValue: number
  invoicesThisMonth: number
}

// Revenue Trend (time-series)
export async function loadRevenueTimeSeries(
  orgId: string,
  days: number = 90
): Promise<DailyRevenuePoint[]> {
  const admin = createAdminSupabaseClient()

  const { data } = await admin
    .from('v_revenue_trend')
    .select('date, daily_revenue, daily_transactions, daily_customers')
    .eq('org_id', orgId)
    .gte('date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('date', { ascending: true })

  return (data || []).map((row: any) => ({
    date: row.date,
    revenue: row.daily_revenue || 0,
    transactions: row.daily_transactions || 0,
    customers: row.daily_customers || 0,
  }))
}

// Monthly Revenue Aggregation
export async function loadMonthlyRevenue(orgId: string, months: number = 12): Promise<MonthlyRevenue[]> {
  const admin = createAdminSupabaseClient()

  const { data } = await admin
    .from('v_monthly_revenue')
    .select('month, revenue_realized, revenue_pending, revenue_total, invoice_count, unique_customers')
    .eq('org_id', orgId)
    .gte('month', new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('month', { ascending: false })

  return (data || []).map((row: any) => ({
    month: row.month,
    realized: row.revenue_realized || 0,
    pending: row.revenue_pending || 0,
    total: row.revenue_total || 0,
    invoiceCount: row.invoice_count || 0,
    uniqueCustomers: row.unique_customers || 0,
  }))
}

// Top Customers
export async function loadTopCustomers(orgId: string, limit: number = 10): Promise<TopCustomer[]> {
  const admin = createAdminSupabaseClient()

  const { data } = await admin
    .from('v_top_customers')
    .select('rank, customer_id, customer_name, lifetime_value, order_count, avg_order_value, revenue_percentage')
    .eq('org_id', orgId)
    .lte('rank', limit)
    .order('rank', { ascending: true })

  return (data || []).map((row: any) => ({
    rank: row.rank,
    customerId: String(row.customer_id),
    customerName: row.customer_name,
    lifetimeValue: row.lifetime_value || 0,
    orderCount: row.order_count || 0,
    avgOrderValue: row.avg_order_value || 0,
    revenuePercentage: row.revenue_percentage || 0,
  }))
}

// All Customer Metrics
export async function loadCustomerMetrics(orgId: string): Promise<CustomerMetric[]> {
  const admin = createAdminSupabaseClient()

  const { data } = await admin
    .from('v_customer_metrics')
    .select(
      'customer_id, customer_name, order_count, lifetime_value, avg_order_value, last_order_date, first_order_date, days_since_last_order, pending_amount'
    )
    .eq('org_id', orgId)
    .order('lifetime_value', { ascending: false })

  return (data || []).map((row: any) => ({
    customerId: String(row.customer_id),
    customerName: row.customer_name,
    orderCount: row.order_count || 0,
    lifetimeValue: row.lifetime_value || 0,
    avgOrderValue: row.avg_order_value || 0,
    lastOrderDate: row.last_order_date,
    firstOrderDate: row.first_order_date,
    daysSinceLastOrder: row.days_since_last_order,
    pendingAmount: row.pending_amount || 0,
  }))
}

// Product Revenue
export async function loadProductRevenue(orgId: string): Promise<ProductRevenue[]> {
  const admin = createAdminSupabaseClient()

  const { data } = await admin
    .from('v_product_revenue')
    .select(
      'produto_id, descricao_produto, revenue_realized, revenue_pending, revenue_total, invoice_count, unique_customers'
    )
    .eq('org_id', orgId)
    .order('revenue_total', { ascending: false })

  return (data || []).map((row: any) => ({
    productId: String(row.produto_id),
    productName: row.descricao_produto,
    realized: row.revenue_realized || 0,
    pending: row.revenue_pending || 0,
    total: row.revenue_total || 0,
    invoiceCount: row.invoice_count || 0,
    uniqueCustomers: row.unique_customers || 0,
  }))
}

// Revenue vs Forecast Variance
export async function loadRevenueVariance(orgId: string, months: number = 12): Promise<RevenueVariance[]> {
  const admin = createAdminSupabaseClient()

  const { data } = await admin
    .from('v_revenue_variance')
    .select('month, forecast_total, realized_total, variance_absolute, variance_percentage')
    .eq('org_id', orgId)
    .gte('month', new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('month', { ascending: false })

  return (data || []).map((row: any) => ({
    month: row.month,
    forecastTotal: row.forecast_total || 0,
    realizedTotal: row.realized_total || 0,
    varianceAbsolute: row.variance_absolute || 0,
    variancePercentage: row.variance_percentage || 0,
  }))
}

// Sales Summary (KPIs)
export async function loadSalesSummary(orgId: string): Promise<SalesSummary> {
  const admin = createAdminSupabaseClient()

  // `loadMonthlyRevenue` has no upper date bound, so ordering by month desc
  // would surface a future-dated invoice (Olist due dates run years ahead
  // of "today" for installment plans) instead of the actual current
  // calendar month. Query the exact current month explicitly instead.
  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const [{ data: currentMonthRows }, topCustomers, last12Months, products] = await Promise.all([
    admin
      .from('v_monthly_revenue')
      .select('revenue_realized, revenue_pending, revenue_total, invoice_count, unique_customers')
      .eq('org_id', orgId)
      .eq('month', currentMonthKey)
      .maybeSingle(),
    loadTopCustomers(orgId, 100),
    loadMonthlyRevenue(orgId, 12),
    loadProductRevenue(orgId),
  ])

  const currentMonth = currentMonthRows
    ? {
        realized: (currentMonthRows as any).revenue_realized || 0,
        invoiceCount: (currentMonthRows as any).invoice_count || 0,
      }
    : { realized: 0, invoiceCount: 0 }

  // Total revenue realized to date: only months up to and including the
  // current one, excluding future-dated (not-yet-due) invoices.
  const currentYear = last12Months.filter((m) => m.month <= currentMonthKey)

  const totalRevenue = currentYear.reduce((sum, m) => sum + m.realized, 0)
  const monthlyRevenue_ = currentMonth.realized
  const invoicesThisMonth = currentMonth.invoiceCount
  const productCount = products.length

  const avgOrderValue = invoicesThisMonth > 0 ? monthlyRevenue_ / invoicesThisMonth : 0

  return {
    totalRevenue,
    monthlyRevenue: monthlyRevenue_,
    topCustomersCount: topCustomers.length,
    productCount,
    averageOrderValue: avgOrderValue,
    invoicesThisMonth,
  }
}
