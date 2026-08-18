-- Fase 6 (parte B): Planejamento de Receita (Prompt Mestre seções 14-17, 32).
-- See docs/superpowers/specs/2026-08-16-fase6-planejamento-receita-design.md.

create table forecast_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  -- Nullable: the seed migration (0015) inserts a "Planejamento Original"
  -- version with no human author. Every write coming through
  -- POST /api/forecast/versoes always sets a real profile id.
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index forecast_versions_org_id_created_at_idx
  on forecast_versions(org_id, created_at desc);

alter table forecast_versions enable row level security;
-- No insert/update/delete policy for anon/authenticated on purpose: writes
-- only via service_role from app/api/forecast/versoes/route.ts, which
-- enforces canEditForecast before writing. A version is never updated or
-- deleted once created — revising the forecast creates a new version.

create policy "members can read forecast_versions in their org" on forecast_versions
  for select using (is_org_member(org_id));

create table forecast_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references forecast_versions(id) on delete cascade,
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  receita numeric not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (version_id, ano, mes)
);

create index forecast_entries_version_id_idx on forecast_entries(version_id);

alter table forecast_entries enable row level security;
-- No org_id column here (scoped through version_id) — the read policy joins
-- back to forecast_versions to check org membership. Writes only via
-- service_role from app/api/forecast/entradas/route.ts.

create policy "members can read forecast_entries in their org" on forecast_entries
  for select using (
    exists (
      select 1 from forecast_versions v
      where v.id = forecast_entries.version_id and is_org_member(v.org_id)
    )
  );

create table forecast_scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index forecast_scenarios_org_id_idx on forecast_scenarios(org_id);

alter table forecast_scenarios enable row level security;
-- Writes only via service_role from app/api/forecast/cenarios/route.ts,
-- gated by canCreateScenario.

create policy "members can read forecast_scenarios in their org" on forecast_scenarios
  for select using (is_org_member(org_id));

create table forecast_scenario_multipliers (
  scenario_id uuid not null references forecast_scenarios(id) on delete cascade,
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  percentual numeric not null check (percentual >= 0),
  primary key (scenario_id, ano, mes)
);

alter table forecast_scenario_multipliers enable row level security;
-- Writes only via service_role from
-- app/api/forecast/cenarios/multiplicadores/route.ts, gated by
-- canCreateScenario.

create policy "members can read forecast_scenario_multipliers in their org" on forecast_scenario_multipliers
  for select using (
    exists (
      select 1 from forecast_scenarios s
      where s.id = forecast_scenario_multipliers.scenario_id and is_org_member(s.org_id)
    )
  );
