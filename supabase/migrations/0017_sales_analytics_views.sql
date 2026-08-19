-- Fase 8: Sales Analytics Views & Aggregations

-- View: Daily Revenue by Customer
create view v_daily_revenue_by_customer as
select
  ar.org_id,
  ar.data_vencimento::date as date,
  ar.cliente_olist_id,
  coalesce(c.nome, 'Cliente Desconhecido') as customer_name,
  sum(ar.valor) filter (where ar.situacao in ('paid', 'processing')) as revenue_realized,
  sum(ar.valor) filter (where ar.situacao not in ('paid', 'processing', 'cancelled')) as revenue_pending,
  sum(ar.valor) as revenue_total
from olist_accounts_receivable ar
left join olist_contacts c on ar.org_id = c.org_id and ar.cliente_olist_id = c.olist_id
group by ar.org_id, ar.data_vencimento::date, ar.cliente_olist_id, c.nome;

-- View: Monthly Revenue Aggregation
create view v_monthly_revenue as
select
  ar.org_id,
  date_trunc('month', ar.data_vencimento)::date as month,
  sum(ar.valor) filter (where ar.situacao in ('paid', 'processing')) as revenue_realized,
  sum(ar.valor) filter (where ar.situacao not in ('paid', 'processing', 'cancelled')) as revenue_pending,
  sum(ar.valor) as revenue_total,
  count(distinct ar.cliente_olist_id) as unique_customers,
  count(*) as invoice_count
from olist_accounts_receivable ar
group by ar.org_id, date_trunc('month', ar.data_vencimento);

-- View: Customer Metrics (LTV, frequency, avg order value)
create view v_customer_metrics as
select
  ar.org_id,
  ar.cliente_olist_id,
  coalesce(c.nome, 'Cliente Desconhecido') as customer_name,
  count(distinct ar.id) as order_count,
  sum(ar.valor) filter (where ar.situacao in ('paid', 'processing')) as lifetime_value,
  avg(ar.valor) as avg_order_value,
  max(ar.data_vencimento)::date as last_order_date,
  min(ar.data_vencimento)::date as first_order_date,
  current_date - max(ar.data_vencimento)::date as days_since_last_order,
  sum(ar.valor) filter (where ar.situacao not in ('paid', 'processing', 'cancelled')) as pending_amount
from olist_accounts_receivable ar
left join olist_contacts c on ar.org_id = c.org_id and ar.cliente_olist_id = c.olist_id
group by ar.org_id, ar.cliente_olist_id, c.nome;

-- View: Product Revenue (aggregated from order items)
create view v_product_revenue as
select
  oi.org_id,
  oi.produto_olist_id,
  oi.descricao_produto,
  sum(oi.valor_unitario * oi.quantidade) filter (where oo.data >= ar.data_emissao and oo.data <= ar.data_vencimento) as revenue_realized,
  0::numeric as revenue_pending,
  sum(oi.valor_unitario * oi.quantidade) as revenue_total,
  count(*) as invoice_count,
  count(distinct oo.cliente_olist_id) as unique_customers
from olist_order_items oi
left join olist_orders oo on oi.org_id = oo.org_id and oi.order_id = oo.id
left join olist_accounts_receivable ar on oo.org_id = ar.org_id and oo.cliente_olist_id = ar.cliente_olist_id
where oi.produto_olist_id is not null
group by oi.org_id, oi.produto_olist_id, oi.descricao_produto;

-- View: Monthly Revenue vs Forecast Variance (simplified)
create view v_revenue_variance as
select
  mr.org_id,
  mr.month,
  0::numeric as forecast_total,
  mr.revenue_realized,
  mr.revenue_realized as variance_absolute,
  0::numeric as variance_percentage
from v_monthly_revenue mr;

-- View: Top Customers by Revenue
create view v_top_customers as
select
  org_id,
  cliente_olist_id,
  customer_name,
  lifetime_value,
  order_count,
  avg_order_value,
  round((lifetime_value / sum(lifetime_value) over (partition by org_id) * 100)::numeric, 2) as revenue_percentage,
  row_number() over (partition by org_id order by lifetime_value desc) as rank
from v_customer_metrics
where lifetime_value > 0;

-- View: Revenue Trend (daily, for charts)
create view v_revenue_trend as
select
  org_id,
  data_vencimento::date as date,
  sum(valor) filter (where situacao in ('paid', 'processing')) as daily_revenue,
  count(*) as daily_transactions,
  count(distinct cliente_olist_id) as daily_customers
from olist_accounts_receivable
group by org_id, data_vencimento::date
order by org_id, data_vencimento::date desc;

-- RLS is not applicable to views in Supabase.
-- Access control is inherited from the underlying tables (olist_accounts_receivable, etc.)
-- Views are read-only and will respect the RLS policies of their source tables.
