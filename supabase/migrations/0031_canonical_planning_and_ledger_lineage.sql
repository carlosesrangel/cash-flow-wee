-- Phase V2: one canonical monthly plan, virtual scenarios and ledger lineage.
-- This migration is additive. Legacy forecast tables stay readable for audit;
-- the new application surface writes only monthly_sales_plan.

alter table financial_ledger add column if not exists superseded_at timestamptz;
alter table financial_ledger add column if not exists superseded_by uuid references financial_ledger(id);
alter table financial_ledger add column if not exists supersession_reason text;

alter table tax_configurations drop constraint if exists tax_configurations_regime_2027_check;
alter table tax_configurations add constraint tax_configurations_regime_2027_check check (regime_2027 in ('simples-nacional-puro', 'simples-tradicional', 'simples-hibrido'));
alter table tax_configurations alter column regime_2027 set default 'simples-nacional-puro';

create index if not exists financial_ledger_active_event_idx
  on financial_ledger(org_id, event_date, direction)
  where superseded_at is null;

create table if not exists monthly_sales_plan (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  competence_month date not null,
  amount numeric(14,2) not null check (amount >= 0),
  source_file text not null default 'planejado wee.xlsx',
  source_sheet text,
  source_row integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  unique(org_id, competence_month),
  constraint monthly_sales_plan_first_day check (extract(day from competence_month) = 1)
);

create index if not exists monthly_sales_plan_org_month_idx on monthly_sales_plan(org_id, competence_month);
alter table monthly_sales_plan enable row level security;
drop policy if exists "members can read monthly_sales_plan in their org" on monthly_sales_plan;
create policy "members can read monthly_sales_plan in their org" on monthly_sales_plan for select using (is_org_member(org_id));
drop policy if exists "members can insert monthly_sales_plan in their org" on monthly_sales_plan;
create policy "members can insert monthly_sales_plan in their org" on monthly_sales_plan for insert with check (is_org_member(org_id));
drop policy if exists "members can update monthly_sales_plan in their org" on monthly_sales_plan;
create policy "members can update monthly_sales_plan in their org" on monthly_sales_plan for update using (is_org_member(org_id)) with check (is_org_member(org_id));

create table if not exists scenario_configurations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations(id) on delete cascade,
  conservative_percent numeric(6,2) not null default 20 check (conservative_percent between 0 and 100),
  optimistic_percent numeric(6,2) not null default 30 check (optimistic_percent between 0 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

alter table scenario_configurations enable row level security;
drop policy if exists "members can read scenario_configurations in their org" on scenario_configurations;
create policy "members can read scenario_configurations in their org" on scenario_configurations for select using (is_org_member(org_id));
drop policy if exists "members can insert scenario_configurations in their org" on scenario_configurations;
create policy "members can insert scenario_configurations in their org" on scenario_configurations for insert with check (is_org_member(org_id));
drop policy if exists "members can update scenario_configurations in their org" on scenario_configurations;
create policy "members can update scenario_configurations in their org" on scenario_configurations for update using (is_org_member(org_id)) with check (is_org_member(org_id));

create table if not exists plan_audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  competence_month date not null,
  previous_amount numeric(14,2),
  new_amount numeric(14,2) not null,
  actor_profile_id uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists plan_audit_log_org_month_idx on plan_audit_log(org_id, competence_month, created_at desc);
alter table plan_audit_log enable row level security;
drop policy if exists "members can read plan_audit_log in their org" on plan_audit_log;
create policy "members can read plan_audit_log in their org" on plan_audit_log for select using (is_org_member(org_id));
drop policy if exists "members can insert plan_audit_log in their org" on plan_audit_log;
create policy "members can insert plan_audit_log in their org" on plan_audit_log for insert with check (is_org_member(org_id));

create or replace function update_monthly_sales_plan_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists monthly_sales_plan_updated_at on monthly_sales_plan;
create trigger monthly_sales_plan_updated_at before update on monthly_sales_plan for each row execute function update_monthly_sales_plan_updated_at();

commit;
