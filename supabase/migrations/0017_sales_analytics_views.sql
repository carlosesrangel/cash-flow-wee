-- Fase 8: Sales Analytics Views & Aggregations

-- View: Daily Revenue by Customer
create view v_daily_revenue_by_customer as
select
  ar.org_id,
  ar.data_vencimento::date as date,
  ar.customer_id,
  ar.customer_name,
  sum(ar.valor) filter (where ar.situacao in ('paid', 'processing')) as revenue_realized,
  sum(ar.valor) filter (where ar.situacao not in ('paid', 'processing', 'cancelled')) as revenue_pending,
  sum(ar.valor) as revenue_total
from olist_accounts_receivable ar
group by ar.org_id, ar.data_vencimento::date, ar.customer_id, ar.customer_name;

-- View: Monthly Revenue Aggregation
create view v_monthly_revenue as
select
  ar.org_id,
  date_trunc('month', ar.data_vencimento)::date as month,
  sum(ar.valor) filter (where ar.situacao in ('paid', 'processing')) as revenue_realized,
  sum(ar.valor) filter (where ar.situacao not in ('paid', 'processing', 'cancelled')) as revenue_pending,
  sum(ar.valor) as revenue_total,
  count(distinct ar.customer_id) as unique_customers,
  count(*) as invoice_count
from olist_accounts_receivable ar
group by ar.org_id, date_trunc('month', ar.data_vencimento);

-- View: Customer Metrics (LTV, frequency, avg order value)
create view v_customer_metrics as
select
  ar.org_id,
  ar.customer_id,
  ar.customer_name,
  count(distinct ar.id) as order_count,
  sum(ar.valor) filter (where ar.situacao in ('paid', 'processing')) as lifetime_value,
  avg(ar.valor) as avg_order_value,
  max(ar.data_vencimento)::date as last_order_date,
  min(ar.data_vencimento)::date as first_order_date,
  current_date - max(ar.data_vencimento)::date as days_since_last_order,
  sum(ar.valor) filter (where ar.situacao not in ('paid', 'processing', 'cancelled')) as pending_amount
from olist_accounts_receivable ar
group by ar.org_id, ar.customer_id, ar.customer_name;

-- View: Product Revenue (if produto_id exists)
create view v_product_revenue as
select
  ar.org_id,
  ar.produto_id,
  ar.descricao_produto,
  sum(ar.valor) filter (where ar.situacao in ('paid', 'processing')) as revenue_realized,
  sum(ar.valor) filter (where ar.situacao not in ('paid', 'processing', 'cancelled')) as revenue_pending,
  sum(ar.valor) as revenue_total,
  count(*) as invoice_count,
  count(distinct ar.customer_id) as unique_customers
from olist_accounts_receivable ar
where ar.produto_id is not null
group by ar.org_id, ar.produto_id, ar.descricao_produto;

-- View: Monthly Revenue vs Forecast Variance
create view v_revenue_variance as
select
  f.org_id,
  date_trunc('month', f.mes_vencimento)::date as month,
  coalesce(sum(f.valor_entrada), 0) as forecast_total,
  coalesce(mr.revenue_realized, 0) as realized_total,
  coalesce(mr.revenue_realized, 0) - coalesce(sum(f.valor_entrada), 0) as variance_absolute,
  case
    when sum(f.valor_entrada) > 0 then
      round(
        ((coalesce(mr.revenue_realized, 0) - coalesce(sum(f.valor_entrada), 0)) / sum(f.valor_entrada) * 100)::numeric,
        2
      )
    else 0
  end as variance_percentage
from forecast_entries f
left join v_monthly_revenue mr on f.org_id = mr.org_id and date_trunc('month', f.mes_vencimento) = mr.month
where f.tipo = 'entrada'
group by f.org_id, date_trunc('month', f.mes_vencimento), mr.revenue_realized;

-- View: Top Customers by Revenue
create view v_top_customers as
select
  org_id,
  customer_id,
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
  count(distinct customer_id) as daily_customers
from olist_accounts_receivable
group by org_id, data_vencimento::date
order by org_id, data_vencimento::date desc;

-- RLS Policies for views (read-only for org members)
alter table v_daily_revenue_by_customer enable row level security;
alter table v_monthly_revenue enable row level security;
alter table v_customer_metrics enable row level security;
alter table v_product_revenue enable row level security;
alter table v_revenue_variance enable row level security;
alter table v_top_customers enable row level security;
alter table v_revenue_trend enable row level security;

create policy "allow_read_for_org_members" on v_daily_revenue_by_customer
  for select using (
    org_id in (
      select org_id from olist_organizations_members
      where profile_id = auth.uid()
    )
  );

create policy "allow_read_for_org_members" on v_monthly_revenue
  for select using (
    org_id in (
      select org_id from olist_organizations_members
      where profile_id = auth.uid()
    )
  );

create policy "allow_read_for_org_members" on v_customer_metrics
  for select using (
    org_id in (
      select org_id from olist_organizations_members
      where profile_id = auth.uid()
    )
  );

create policy "allow_read_for_org_members" on v_product_revenue
  for select using (
    org_id in (
      select org_id from olist_organizations_members
      where profile_id = auth.uid()
    )
  );

create policy "allow_read_for_org_members" on v_revenue_variance
  for select using (
    org_id in (
      select org_id from olist_organizations_members
      where profile_id = auth.uid()
    )
  );

create policy "allow_read_for_org_members" on v_top_customers
  for select using (
    org_id in (
      select org_id from olist_organizations_members
      where profile_id = auth.uid()
    )
  );

create policy "allow_read_for_org_members" on v_revenue_trend
  for select using (
    org_id in (
      select org_id from olist_organizations_members
      where profile_id = auth.uid()
    )
  );
