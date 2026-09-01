create table if not exists financial_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_finished_at timestamptz,
  sumup_finished_at timestamptz,
  analytics_finished_at timestamptz not null default now(),
  ledger_finished_at timestamptz not null default now(),
  calculation_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists financial_refresh_runs_org_created_idx
  on financial_refresh_runs(org_id, created_at desc);

alter table financial_refresh_runs enable row level security;
create policy "members can read financial refresh runs in their org"
  on financial_refresh_runs for select using (is_org_member(org_id));
