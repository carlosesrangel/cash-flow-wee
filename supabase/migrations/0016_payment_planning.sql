-- Fase 7: Planejador de Pagamentos (Payment Scenario Engine)
-- See docs/superpowers/plans/2026-08-XX-fase7-payment-planning-plan.md

create table planned_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  ap_id uuid not null references olist_accounts_payable(id) on delete cascade,
  planned_date text not null, -- YYYY-MM-DD, when we plan to actually pay this AP
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (org_id, ap_id) -- one planned date per AP per org
);

create index planned_payments_org_id_idx on planned_payments(org_id);
create index planned_payments_ap_id_idx on planned_payments(ap_id);

alter table planned_payments enable row level security;
create policy "members can read planned_payments in their org" on planned_payments
  for select using (is_org_member(org_id));
-- Writes only via service_role from app/api/payments/planned/route.ts

create table payment_scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null, -- "Delay All 15 Days", "Pay Only Urgent", "Consolidate", etc.
  description text,
  is_default boolean default false, -- marks the "baseline" scenario for comparison
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index payment_scenarios_org_id_idx on payment_scenarios(org_id);

alter table payment_scenarios enable row level security;
create policy "members can read payment_scenarios in their org" on payment_scenarios
  for select using (is_org_member(org_id));
-- Writes only via service_role

create table scenario_adjustments (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references payment_scenarios(id) on delete cascade,
  ap_id uuid not null references olist_accounts_payable(id) on delete cascade,
  days_delta integer default 0, -- shift payment date by N days (e.g., -15 = delay by 15 days)
  percentage numeric not null default 100 check (percentage >= 0 and percentage <= 100), -- pay X% of the amount (e.g., 50 = pay half now, half later)
  created_at timestamptz not null default now(),
  unique (scenario_id, ap_id) -- one adjustment per AP per scenario
);

create index scenario_adjustments_scenario_id_idx on scenario_adjustments(scenario_id);
create index scenario_adjustments_ap_id_idx on scenario_adjustments(ap_id);

alter table scenario_adjustments enable row level security;
create policy "members can read scenario_adjustments in their org" on scenario_adjustments
  for select using (
    exists (
      select 1 from payment_scenarios ps
      where ps.id = scenario_adjustments.scenario_id and is_org_member(ps.org_id)
    )
  );
-- Writes only via service_role
