-- RPC function to aggregate projected AR by month for display in planning grid.
-- Groups by data_vencimento (month) and sums valor_liquido, counts modalidades, max parcelas.

create or replace function get_projected_ar_summary(p_version_id uuid)
returns table (
  data_vencimento date,
  valor_total numeric,
  modalidades integer,
  parcelas_max integer
) as $$
  select
    date_trunc('month', arp.data_vencimento)::date as data_vencimento,
    sum(arp.valor_liquido) as valor_total,
    count(distinct arp.modalidade) as modalidades,
    max(arp.parcelas) as parcelas_max
  from accounts_receivable_projected arp
  where arp.version_id = p_version_id
  group by date_trunc('month', arp.data_vencimento)
  order by data_vencimento
$$ language sql stable security definer;

comment on function get_projected_ar_summary is 'Aggregates accounts_receivable_projected by month for planning grid display';

alter function get_projected_ar_summary(p_version_id uuid) owner to postgres;
