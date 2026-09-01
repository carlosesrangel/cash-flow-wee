-- Fields exposed by GET /contas-pagar/{idContaPagar}; all are nullable for
-- compatibility with records imported before detail enrichment was enabled.
alter table olist_accounts_payable
  add column if not exists categoria_id bigint,
  add column if not exists categoria text,
  add column if not exists valor_pago numeric,
  add column if not exists data_liquidacao date;

create index if not exists olist_accounts_payable_categoria_idx
  on olist_accounts_payable(org_id, categoria);
