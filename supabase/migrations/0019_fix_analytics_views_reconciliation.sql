-- Fix Fase 8 sales analytics views: revenue_realized was computed from
-- ar.situacao in ('paid','processing'), but Olist's /contas-receber never
-- transitions situacao away from 'aberto' for this org — payment
-- confirmation happens externally via SumUp, not inside Olist. The actual
-- signal for "this receivable was truly collected" is a resolved
-- reconciliation_matches row (status = 'reconciliado_automaticamente'),
-- which is exactly what the reconciliation engine (lib/reconciliation) was
-- built to produce. This migration re-points every view at that signal
-- instead of the never-changing situacao field.

drop view if exists v_revenue_variance;
drop view if exists v_top_customers;
drop view if exists v_daily_revenue_by_customer;
drop view if exists v_monthly_revenue;
drop view if exists v_customer_metrics;
drop view if exists v_product_revenue;
drop view if exists v_revenue_trend;

-- View: Daily Revenue by Customer
create view v_daily_revenue_by_customer as
select
  ar.org_id,
  ar.data_vencimento::date as date,
  ar.cliente_olist_id,
  coalesce(c.nome, 'Cliente Desconhecido') as customer_name,
  sum(ar.valor) filter (where rm.status = 'reconciliado_automaticamente') as revenue_realized,
  sum(ar.valor) filter (where rm.status is distinct from 'reconciliado_automaticamente') as revenue_pending,
  sum(ar.valor) as revenue_total
from olist_accounts_receivable ar
left join olist_contacts c on ar.org_id = c.org_id and ar.cliente_olist_id = c.olist_id
left join reconciliation_matches rm on rm.olist_accounts_receivable_id = ar.id
where ar.situacao is distinct from 'cancelado'
group by ar.org_id, ar.data_vencimento::date, ar.cliente_olist_id, c.nome;

-- View: Monthly Revenue Aggregation
create view v_monthly_revenue as
select
  ar.org_id,
  date_trunc('month', ar.data_vencimento)::date as month,
  sum(ar.valor) filter (where rm.status = 'reconciliado_automaticamente') as revenue_realized,
  sum(ar.valor) filter (where rm.status is distinct from 'reconciliado_automaticamente') as revenue_pending,
  sum(ar.valor) as revenue_total,
  count(distinct ar.cliente_olist_id) as unique_customers,
  count(*) as invoice_count
from olist_accounts_receivable ar
left join reconciliation_matches rm on rm.olist_accounts_receivable_id = ar.id
where ar.situacao is distinct from 'cancelado'
group by ar.org_id, date_trunc('month', ar.data_vencimento);

-- View: Customer Metrics (LTV, frequency, avg order value).
-- `customer_id` alias matches what lib/analytics/engine.ts selects — the
-- previous view only exposed `cliente_olist_id`, silently dropped by
-- PostgREST instead of erroring, which is why every customer row in the UI
-- showed a blank id (and the Clientes page appeared empty after sorting).
create view v_customer_metrics as
select
  ar.org_id,
  ar.cliente_olist_id as customer_id,
  coalesce(c.nome, 'Cliente Desconhecido') as customer_name,
  count(distinct ar.id) as order_count,
  sum(ar.valor) filter (where rm.status = 'reconciliado_automaticamente') as lifetime_value,
  avg(ar.valor) as avg_order_value,
  max(ar.data_vencimento)::date as last_order_date,
  min(ar.data_vencimento)::date as first_order_date,
  current_date - max(ar.data_vencimento)::date as days_since_last_order,
  sum(ar.valor) filter (where rm.status is distinct from 'reconciliado_automaticamente') as pending_amount
from olist_accounts_receivable ar
left join olist_contacts c on ar.org_id = c.org_id and ar.cliente_olist_id = c.olist_id
left join reconciliation_matches rm on rm.olist_accounts_receivable_id = ar.id
where ar.situacao is distinct from 'cancelado'
group by ar.org_id, ar.cliente_olist_id, c.nome;

-- View: Product Revenue (aggregated from order items).
-- Realized/pending split now keys off whether the parent order's AR row was
-- reconciled — the previous version's date-range join against
-- olist_accounts_receivable.data_emissao was unrelated to actual payment.
-- `produto_id` alias matches what lib/analytics/engine.ts selects — the
-- previous view only exposed `produto_olist_id`, a column name PostgREST
-- silently dropped from the response instead of erroring, which is why
-- every product row in the UI showed a blank id.
create view v_product_revenue as
select
  oi.org_id,
  oi.produto_olist_id as produto_id,
  oi.descricao_produto,
  sum(oi.valor_unitario * oi.quantidade) filter (
    where exists (
      select 1
      from olist_orders oo2
      join olist_accounts_receivable ar2 on ar2.org_id = oo2.org_id and ar2.cliente_olist_id = oo2.cliente_olist_id
      join reconciliation_matches rm2 on rm2.olist_accounts_receivable_id = ar2.id
      where oo2.id = oi.order_id and rm2.status = 'reconciliado_automaticamente'
    )
  ) as revenue_realized,
  sum(oi.valor_unitario * oi.quantidade) filter (
    where not exists (
      select 1
      from olist_orders oo2
      join olist_accounts_receivable ar2 on ar2.org_id = oo2.org_id and ar2.cliente_olist_id = oo2.cliente_olist_id
      join reconciliation_matches rm2 on rm2.olist_accounts_receivable_id = ar2.id
      where oo2.id = oi.order_id and rm2.status = 'reconciliado_automaticamente'
    )
  ) as revenue_pending,
  sum(oi.valor_unitario * oi.quantidade) as revenue_total,
  count(*) as invoice_count,
  count(distinct oo.cliente_olist_id) as unique_customers
from olist_order_items oi
left join olist_orders oo on oi.org_id = oo.org_id and oi.order_id = oo.id
where oi.produto_olist_id is not null
group by oi.org_id, oi.produto_olist_id, oi.descricao_produto;

-- View: Monthly Revenue vs Forecast Variance — now joins the real
-- forecast_entries table (previous version hardcoded forecast_total to 0).
create view v_revenue_variance as
select
  mr.org_id,
  mr.month,
  coalesce(fe.receita, 0) as forecast_total,
  mr.revenue_realized,
  coalesce(mr.revenue_realized, 0) - coalesce(fe.receita, 0) as variance_absolute,
  case
    when coalesce(fe.receita, 0) = 0 then 0
    else round(((coalesce(mr.revenue_realized, 0) - fe.receita) / fe.receita * 100)::numeric, 2)
  end as variance_percentage
from v_monthly_revenue mr
left join lateral (
  select fe.receita
  from forecast_entries fe
  join forecast_versions fv on fv.id = fe.version_id
  where fv.org_id = mr.org_id
    and fe.ano = extract(year from mr.month)::int
    and fe.mes = extract(month from mr.month)::int
  order by fv.created_at desc
  limit 1
) fe on true;

-- View: Top Customers by Revenue
create view v_top_customers as
select
  org_id,
  customer_id,
  customer_name,
  lifetime_value,
  order_count,
  avg_order_value,
  round((lifetime_value / nullif(sum(lifetime_value) over (partition by org_id), 0) * 100)::numeric, 2) as revenue_percentage,
  row_number() over (partition by org_id order by lifetime_value desc) as rank
from v_customer_metrics
where lifetime_value > 0;

-- View: Revenue Trend (daily, for charts)
create view v_revenue_trend as
select
  ar.org_id,
  ar.data_vencimento::date as date,
  sum(ar.valor) filter (where rm.status = 'reconciliado_automaticamente') as daily_revenue,
  count(*) as daily_transactions,
  count(distinct ar.cliente_olist_id) as daily_customers
from olist_accounts_receivable ar
left join reconciliation_matches rm on rm.olist_accounts_receivable_id = ar.id
where ar.situacao is distinct from 'cancelado'
group by ar.org_id, ar.data_vencimento::date
order by ar.org_id, ar.data_vencimento::date desc;

-- RLS is not applicable to views in Supabase.
-- Access control is inherited from the underlying tables (olist_accounts_receivable, etc.)
-- Views are read-only and will respect the RLS policies of their source tables.
