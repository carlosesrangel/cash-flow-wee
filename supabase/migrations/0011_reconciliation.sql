-- Fase 4: reconciliation layer (Olist AR installments x SumUp settlements).

-- The Olist AR detail endpoint (GET /contas-receber/{id}, not used by the
-- listing-only sync from Fase 2) exposes per-installment fee, payment
-- method, and settlement fields that the listing endpoint never returns.
-- See docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md,
-- finding 4.
alter table olist_accounts_receivable
  add column taxa numeric,
  add column valor_pago numeric,
  add column forma_recebimento_id bigint,
  add column forma_recebimento_nome text,
  add column data_liquidacao date;

create index olist_accounts_receivable_forma_recebimento_nome_idx
  on olist_accounts_receivable(forma_recebimento_nome);

create table reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_accounts_receivable_id uuid not null references olist_accounts_receivable(id) on delete cascade,
  sumup_transaction_id uuid references sumup_transactions(id) on delete set null,
  sumup_transaction_event_id uuid references sumup_transaction_events(id) on delete set null,
  status text not null check (
    status in ('reconciliado_automaticamente', 'reconciliado_manualmente', 'nao_reconciliado', 'conflito')
  ),
  match_reason jsonb not null default '{}'::jsonb,
  candidate_ids jsonb not null default '[]'::jsonb,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, olist_accounts_receivable_id)
);

create index reconciliation_matches_org_id_idx on reconciliation_matches(org_id);
create index reconciliation_matches_status_idx on reconciliation_matches(status);

alter table reconciliation_matches enable row level security;

create policy "members can read reconciliation_matches in their org" on reconciliation_matches
  for select using (is_org_member(org_id));
