-- RFV source of truth: valid Olist orders, not AR installment rows.
-- This prevents installments from inflating order frequency and LTV.
create or replace view v_customer_metrics as
select
  oo.org_id,
  oo.cliente_olist_id as customer_id,
  coalesce(c.nome, 'Cliente Desconhecido') as customer_name,
  count(distinct oo.id) as order_count,
  sum(oo.valor_total_pedido) as lifetime_value,
  avg(oo.valor_total_pedido) as avg_order_value,
  max(oo.data)::date as last_order_date,
  min(oo.data)::date as first_order_date,
  ((now() at time zone 'America/Sao_Paulo')::date - max(oo.data)::date) as days_since_last_order,
  0::numeric as pending_amount
from olist_orders oo
left join olist_contacts c on oo.org_id = c.org_id and oo.cliente_olist_id = c.olist_id
where oo.cliente_olist_id is not null
  and oo.data is not null
  and oo.valor_total_pedido is not null
  and oo.valor_total_pedido > 0
  and lower(coalesce(oo.raw->>'situacao_nome', '')) not in ('cancelado', 'cancelada', 'cancelled', 'canceled')
group by oo.org_id, oo.cliente_olist_id, c.nome;
