import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'

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
  unitsSold: number
}

export type ProductRevenue = {
  productId: string
  productName: string
  realized: number
  pending: number
  total: number
  invoiceCount: number
  uniqueCustomers: number
  sku: string | null
  unitsSold: number
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
  totalOrders: number
  pieces: number
  averagePrice: number
  piecesPerOrder: number
  clients: number
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

  const metrics = (data || []).map((row: ViewRow) => ({
    customerId: String(row.customer_id),
    customerName: row.customer_name as string,
    orderCount: (row.order_count as number) || 0,
    lifetimeValue: (row.lifetime_value as number) || 0,
    avgOrderValue: (row.avg_order_value as number) || 0,
    lastOrderDate: row.last_order_date as string | null,
    firstOrderDate: row.first_order_date as string | null,
    daysSinceLastOrder: row.days_since_last_order as number | null,
    pendingAmount: (row.pending_amount as number) || 0,
    unitsSold: 0,
  }))
  const orders = await fetchAllPages<{ id: string; cliente_olist_id: number | null }>(
    (from, to) => admin.from('olist_orders').select('id, cliente_olist_id').eq('org_id', orgId).range(from, to),
    'Failed to load customer orders'
  )
  const orderCustomer = new Map(orders.map((order) => [order.id, order.cliente_olist_id]))
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length > 0) {
    const items = await fetchAllPages<{ order_id: string; quantidade: number | null }>(
      (from, to) => admin.from('olist_order_items').select('order_id, quantidade').eq('org_id', orgId).in('order_id', orderIds).range(from, to),
      'Failed to load customer order items'
    )
    const unitsByCustomer = new Map<number, number>()
    for (const item of items) {
      const customerId = orderCustomer.get(item.order_id)
      if (customerId === null || customerId === undefined) continue
      unitsByCustomer.set(customerId, (unitsByCustomer.get(customerId) ?? 0) + Number(item.quantidade ?? 0))
    }
    for (const metric of metrics) metric.unitsSold = unitsByCustomer.get(Number(metric.customerId)) ?? 0
  }
  return metrics
}

// Product Revenue
export async function loadProductRevenue(
  orgId: string,
  startDate?: Date,
  endDate?: Date
): Promise<ProductRevenue[]> {
  const admin = createAdminSupabaseClient()
  const start = startDate?.toISOString().slice(0, 10)
  const end = endDate?.toISOString().slice(0, 10)
  const orders = await fetchAllPages<{ id: string; data: string | null; cliente_olist_id: number | null }>((from, to) => {
    let query = admin.from('olist_orders').select('id, data, cliente_olist_id').eq('org_id', orgId).range(from, to)
    if (start) query = query.gte('data', start)
    if (end) query = query.lte('data', end)
    return query
  }, 'Failed to load product orders')
  const orderIds = orders.map((order) => order.id)
  if (orderIds.length === 0) return []
  const orderById = new Map(orders.map((order) => [order.id, order]))
  const items = await fetchAllPages<{ order_id: string; produto_olist_id: number | null; descricao_produto: string | null; sku: string | null; quantidade: number | null; valor_unitario: number | null }>(
    (from, to) => admin.from('olist_order_items').select('order_id, produto_olist_id, descricao_produto, sku, quantidade, valor_unitario').eq('org_id', orgId).in('order_id', orderIds).range(from, to),
    'Failed to load product order items'
  )
  const grouped = new Map<string, { name: string; sku: string | null; units: number; revenue: number; orders: Set<string>; customers: Set<number> }>()
  for (const item of items) {
    if (item.produto_olist_id === null) continue
    const key = String(item.produto_olist_id)
    const current = grouped.get(key) ?? { name: item.descricao_produto ?? 'Produto sem descrição', sku: item.sku ?? null, units: 0, revenue: 0, orders: new Set(), customers: new Set() }
    current.units += Number(item.quantidade ?? 0)
    current.revenue += Number(item.quantidade ?? 0) * Number(item.valor_unitario ?? 0)
    current.orders.add(item.order_id)
    const customerId = orderById.get(item.order_id)?.cliente_olist_id
    if (customerId !== null && customerId !== undefined) current.customers.add(customerId)
    grouped.set(key, current)
  }
  return Array.from(grouped.entries()).map(([productId, product]) => ({ productId, productName: product.name, sku: product.sku, unitsSold: product.units, realized: product.revenue, pending: 0, total: product.revenue, invoiceCount: product.orders.size, uniqueCustomers: product.customers.size })).sort((a, b) => b.unitsSold - a.unitsSold)
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
  const start = startDate?.toISOString().slice(0, 10)
  const end = endDate?.toISOString().slice(0, 10)
  const orders = await fetchAllPages<{ id: string; data: string | null; cliente_olist_id: number | null; valor_total_pedido: number | null }>(
    (from, to) => {
      let query = admin.from('olist_orders').select('id, data, cliente_olist_id, valor_total_pedido').eq('org_id', orgId).range(from, to)
      if (start) query = query.gte('data', start)
      if (end) query = query.lte('data', end)
      return query
    },
    'Failed to load orders for sales summary'
  )
  const orderIds = orders.map((order) => order.id)
  const items = orderIds.length === 0 ? [] : await fetchAllPages<{ order_id: string; produto_olist_id: number | null; quantidade: number | null; valor_unitario: number | null }>(
    (from, to) => admin.from('olist_order_items').select('order_id, produto_olist_id, quantidade, valor_unitario').eq('org_id', orgId).in('order_id', orderIds).range(from, to),
    'Failed to load order items for sales summary'
  )
  const totalRevenue = orders.reduce((sum, order) => sum + Number(order.valor_total_pedido ?? 0), 0)
  const pieces = items.reduce((sum, item) => sum + Number(item.quantidade ?? 0), 0)
  const itemRevenue = items.reduce((sum, item) => sum + Number(item.quantidade ?? 0) * Number(item.valor_unitario ?? 0), 0)
  const totalOrders = orders.length
  const clients = new Set(orders.map((order) => order.cliente_olist_id).filter((id): id is number => id !== null)).size
  const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

  return {
    totalRevenue,
    totalOrders,
    pieces,
    averagePrice: pieces > 0 ? itemRevenue / pieces : 0,
    piecesPerOrder: totalOrders > 0 ? pieces / totalOrders : 0,
    clients,
    monthlyRevenue: totalRevenue,
    topCustomersCount: clients,
    productCount: new Set(items.map((item) => item.produto_olist_id).filter((id): id is number => id !== null)).size,
    averageOrderValue,
    invoicesThisMonth: totalOrders,
  }
}
