import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>
type ViewRow = Record<string, unknown>

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
  days: number = 90,
  startDate?: Date,
  endDate?: Date
): Promise<DailyRevenuePoint[]> {
  const admin = createAdminSupabaseClient()

  const start = startDate
    ? startDate.toISOString().split('T')[0]
    : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const end = endDate ? endDate.toISOString().split('T')[0] : undefined

  let query = admin
    .from('v_revenue_trend')
    .select('date, daily_revenue, daily_transactions, daily_customers')
    .eq('org_id', orgId)
    .gte('date', start)

  if (end) {
    query = query.lte('date', end)
  }

  const { data } = await query.order('date', { ascending: true })

  return (data || []).map((row: ViewRow) => ({
    date: row.date as string,
    revenue: (row.daily_revenue as number) || 0,
    transactions: (row.daily_transactions as number) || 0,
    customers: (row.daily_customers as number) || 0,
  }))
}

// Monthly Revenue Aggregation
export async function loadMonthlyRevenue(
  orgId: string,
  months: number = 12,
  startDate?: Date,
  endDate?: Date
): Promise<MonthlyRevenue[]> {
  const admin = createAdminSupabaseClient()

  const start = startDate
    ? startDate.toISOString().split('T')[0]
    : new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const end = endDate ? endDate.toISOString().split('T')[0] : undefined

  let query = admin
    .from('v_monthly_revenue')
    .select('month, revenue_realized, revenue_pending, revenue_total, invoice_count, unique_customers')
    .eq('org_id', orgId)
    .gte('month', start)

  if (end) {
    query = query.lte('month', end)
  }

  const { data } = await query.order('month', { ascending: false })

  return (data || []).map((row: ViewRow) => ({
    month: row.month as string,
    realized: (row.revenue_realized as number) || 0,
    pending: (row.revenue_pending as number) || 0,
    total: (row.revenue_total as number) || 0,
    invoiceCount: (row.invoice_count as number) || 0,
    uniqueCustomers: (row.unique_customers as number) || 0,
  }))
}

// Top Customers
export async function loadTopCustomers(
  orgId: string,
  limit: number = 10,
  startDate?: Date,
  endDate?: Date
): Promise<TopCustomer[]> {
  const admin = createAdminSupabaseClient()

  let query = admin
    .from('v_top_customers')
    .select('rank, customer_id, customer_name, lifetime_value, order_count, avg_order_value, revenue_percentage')
    .eq('org_id', orgId)
    .lte('rank', limit)

  if (startDate) {
    query = query.gte('created_date', startDate.toISOString().split('T')[0])
  }

  if (endDate) {
    query = query.lte('created_date', endDate.toISOString().split('T')[0])
  }

  const { data } = await query.order('rank', { ascending: true })

  return (data || []).map((row: ViewRow) => ({
    rank: row.rank as number,
    customerId: String(row.customer_id),
    customerName: row.customer_name as string,
    lifetimeValue: (row.lifetime_value as number) || 0,
    orderCount: (row.order_count as number) || 0,
    avgOrderValue: (row.avg_order_value as number) || 0,
    revenuePercentage: (row.revenue_percentage as number) || 0,
  }))
}

// All Customer Metrics
export async function loadCustomerMetrics(
  orgId: string,
  startDate?: Date,
  endDate?: Date
): Promise<CustomerMetric[]> {
  const admin = createAdminSupabaseClient()

  let query = admin
    .from('v_customer_metrics')
    .select(
      'customer_id, customer_name, order_count, lifetime_value, avg_order_value, last_order_date, first_order_date, days_since_last_order, pending_amount'
    )
    .eq('org_id', orgId)

  if (startDate) {
    query = query.gte('created_date', startDate.toISOString().split('T')[0])
  }

  if (endDate) {
    query = query.lte('created_date', endDate.toISOString().split('T')[0])
  }

  const { data } = await query.order('lifetime_value', { ascending: false })

  return (data || []).map((row: ViewRow) => ({
    customerId: String(row.customer_id),
    customerName: row.customer_name as string,
    orderCount: (row.order_count as number) || 0,
    lifetimeValue: (row.lifetime_value as number) || 0,
    avgOrderValue: (row.avg_order_value as number) || 0,
    lastOrderDate: row.last_order_date as string | null,
    firstOrderDate: row.first_order_date as string | null,
    daysSinceLastOrder: row.days_since_last_order as number | null,
    pendingAmount: (row.pending_amount as number) || 0,
  }))
}

// Product Revenue
export async function loadProductRevenue(
  orgId: string,
  startDate?: Date,
  endDate?: Date
): Promise<ProductRevenue[]> {
  const admin = createAdminSupabaseClient()

  let query = admin
    .from('v_product_revenue')
    .select(
      'produto_id, descricao_produto, revenue_realized, revenue_pending, revenue_total, invoice_count, unique_customers'
    )
    .eq('org_id', orgId)

  if (startDate) {
    query = query.gte('created_date', startDate.toISOString().split('T')[0])
  }

  if (endDate) {
    query = query.lte('created_date', endDate.toISOString().split('T')[0])
  }

  const { data } = await query.order('revenue_total', { ascending: false })

  return (data || []).map((row: ViewRow) => ({
    productId: String(row.produto_id),
    productName: row.descricao_produto as string,
    realized: (row.revenue_realized as number) || 0,
    pending: (row.revenue_pending as number) || 0,
    total: (row.revenue_total as number) || 0,
    invoiceCount: (row.invoice_count as number) || 0,
    uniqueCustomers: (row.unique_customers as number) || 0,
  }))
}

// Revenue vs Forecast Variance
export async function loadRevenueVariance(
  orgId: string,
  months: number = 12,
  startDate?: Date,
  endDate?: Date
): Promise<RevenueVariance[]> {
  const admin = createAdminSupabaseClient()

  const start = startDate
    ? startDate.toISOString().split('T')[0]
    : new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const end = endDate ? endDate.toISOString().split('T')[0] : undefined

  let query = admin
    .from('v_revenue_variance')
    .select('month, forecast_total, realized_total, variance_absolute, variance_percentage')
    .eq('org_id', orgId)
    .gte('month', start)

  if (end) {
    query = query.lte('month', end)
  }

  const { data } = await query.order('month', { ascending: false })

  return (data || []).map((row: ViewRow) => ({
    month: row.month as string,
    forecastTotal: (row.forecast_total as number) || 0,
    realizedTotal: (row.realized_total as number) || 0,
    varianceAbsolute: (row.variance_absolute as number) || 0,
    variancePercentage: (row.variance_percentage as number) || 0,
  }))
}

// Sales Summary (KPIs)
export async function loadSalesSummary(orgId: string, startDate?: Date, endDate?: Date): Promise<SalesSummary> {
  const admin = createAdminSupabaseClient()

  const now = new Date()
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  let currentMonthQuery = admin
    .from('v_monthly_revenue')
    .select('revenue_realized, revenue_pending, revenue_total, invoice_count, unique_customers')
    .eq('org_id', orgId)
    .eq('month', currentMonthKey)

  if (startDate && endDate) {
    const startMonthKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`
    const endMonthKey = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`
    currentMonthQuery = admin
      .from('v_monthly_revenue')
      .select('revenue_realized, revenue_pending, revenue_total, invoice_count, unique_customers')
      .eq('org_id', orgId)
      .gte('month', startMonthKey)
      .lte('month', endMonthKey)
  }

  const [{ data: currentMonthRows }, topCustomers, last12Months, products] = await Promise.all([
    currentMonthQuery.maybeSingle(),
    loadTopCustomers(orgId, 100, startDate, endDate),
    loadMonthlyRevenue(orgId, 12, startDate, endDate),
    loadProductRevenue(orgId, startDate, endDate),
  ])

  const currentMonth = currentMonthRows
    ? {
        realized: ((currentMonthRows as ViewRow).revenue_realized as number) || 0,
        invoiceCount: ((currentMonthRows as ViewRow).invoice_count as number) || 0,
      }
    : { realized: 0, invoiceCount: 0 }

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
