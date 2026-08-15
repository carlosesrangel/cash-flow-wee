-- Fase 5: cash flow engine foundation (Prompt Mestre seções 21-22).
-- See docs/superpowers/specs/2026-08-15-fase5-cashflow-design.md.

create table cash_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  reference_date date not null,
  bank_balance numeric not null,
  cash_on_hand numeric,
  liquid_investments numeric,
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index cash_balance_snapshots_org_id_reference_date_idx
  on cash_balance_snapshots(org_id, reference_date desc);

alter table cash_balance_snapshots enable row level security;
-- No insert/update/delete policy for anon/authenticated on purpose: writes
-- only via service_role from app/api/caixa/saldo/route.ts, which enforces
-- canManageCashBalance (OWNER_ADMIN only) before writing. Snapshots are
-- never updated or deleted — a correction is a new row.

create policy "members can read cash_balance_snapshots in their org" on cash_balance_snapshots
  for select using (is_org_member(org_id));

create table manual_cash_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  type text not null check (type in ('entrada', 'saida', 'ajuste_saldo')),
  description text not null,
  -- entrada/saida amounts are always positive magnitudes (direction comes
  -- from `type`); ajuste_saldo is a signed delta to the confirmed balance
  -- (positive = corrects the balance up, negative = down), so it alone is
  -- exempt from the amount > 0 check.
  amount numeric not null check (type = 'ajuste_saldo' or amount > 0),
  entry_date date not null,
  responsible_profile_id uuid not null references profiles(id),
  justification text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index manual_cash_entries_org_id_entry_date_idx
  on manual_cash_entries(org_id, entry_date);

alter table manual_cash_entries enable row level security;
-- Same pattern: writes only via service_role from
-- app/api/caixa/ajustes/route.ts. Soft-deleted only (deleted_at) — never a
-- hard delete, per Prompt Mestre seção 22 ("nunca apagar silenciosamente").

create policy "members can read manual_cash_entries in their org" on manual_cash_entries
  for select using (is_org_member(org_id));
