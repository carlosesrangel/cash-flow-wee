create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  integration text not null check (integration in ('olist', 'sumup')),
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_processed integer not null default 0,
  records_received integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  error_count integer not null default 0,
  error_message text
);

create index sync_runs_org_id_idx on sync_runs(org_id);
create index sync_runs_integration_idx on sync_runs(integration);

alter table sync_runs enable row level security;

create policy "members can read sync runs in their org"
  on sync_runs for select
  using (is_org_member(org_id));
