-- Fase 8 Extended Planning: Sales Mix, CMV Projections, and 60-month forecasts (2026-2030).
-- Supports:
-- 1. Sales mix assumptions (payment methods, installments, card rates, settlement days)
-- 2. CMV projections with lagged quarterly allocation (Q2 budget spent in Q1)
-- 3. Extended forecast_entries to 60 months with monthly targets

-- Table: sales_mix — payment method distribution for sales projections.
-- Describes the historical/expected mix of payment methods, installment counts,
-- card processing fees, and settlement timing for this org.
create table sales_mix (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  version_id uuid not null references forecast_versions(id) on delete cascade,
  modalidade text not null check (modalidade in ('credito', 'debito', 'pix', 'dinheiro')),
  percentual numeric not null check (percentual >= 0 and percentual <= 100),
  parcelas_media numeric not null default 1 check (parcelas_media >= 1),
  taxa_cartao numeric not null default 0 check (taxa_cartao >= 0 and taxa_cartao <= 1),
  dias_recebimento integer not null default 0 check (dias_recebimento >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, modalidade)
);

create index sales_mix_version_id_idx on sales_mix(version_id);
create index sales_mix_org_id_idx on sales_mix(org_id);

alter table sales_mix enable row level security;

create policy "members can read sales_mix in their org" on sales_mix
  for select using (
    exists (
      select 1 from forecast_versions fv
      where fv.id = sales_mix.version_id and is_org_member(fv.org_id)
    )
  );

-- Table: cmv_projections — Cost of Merchandise (CMV) with lagged quarterly allocation.
-- Q2 budget is allocated (spent) in Q1, distributed bi-weekly.
-- Example: Q2 (Apr-Jun) CMV is spent bi-weekly in Q1 (Jan-Mar).
create table cmv_projections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references forecast_versions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  -- Ano/mes of the quarter WHEN CMV is spent (where it appears on cash flow)
  ano_gasto integer not null,
  mes_gasto integer not null check (mes_gasto between 1 and 12),
  -- Ano/mes of the quarter whose budget this CMV comes from (Q+1)
  trimestre_origem text not null, -- e.g., 'Q2-2026' (Apr-Jun 2026) → spent in Q1 (Jan-Mar)
  valor_cmv numeric not null check (valor_cmv >= 0),
  -- Which bi-week this was allocated to (semana_1, semana_2, semana_3, semana_4)
  semana text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cmv_projections_version_id_idx on cmv_projections(version_id);
create index cmv_projections_org_id_idx on cmv_projections(org_id);
create index cmv_projections_ano_mes_idx on cmv_projections(ano_gasto, mes_gasto);

alter table cmv_projections enable row level security;

create policy "members can read cmv_projections in their org" on cmv_projections
  for select using (is_org_member(org_id));

-- Table: planning_assumptions — stores the assumptions used to derive a forecast version.
-- Used to understand what drove the projections and for reproducibility.
create table planning_assumptions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references forecast_versions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  assumption_key text not null, -- e.g., 'seasonal_factor', 'monthly_growth', 'base_revenue'
  valor_numerico numeric,
  valor_texto text,
  created_at timestamptz not null default now(),
  unique (version_id, assumption_key)
);

create index planning_assumptions_version_id_idx on planning_assumptions(version_id);
create index planning_assumptions_org_id_idx on planning_assumptions(org_id);

alter table planning_assumptions enable row level security;

create policy "members can read planning_assumptions in their org" on planning_assumptions
  for select using (
    exists (
      select 1 from forecast_versions fv
      where fv.id = planning_assumptions.version_id and is_org_member(fv.org_id)
    )
  );

-- Table: accounts_receivable_projected — AR projected from sales forecasts.
-- Combines forecast_entries (monthly revenue target) with sales_mix to derive expected AR entries.
-- Key: when sales happen (forecast_entries.ano/mes) → when they settle (+ dias_recebimento from mix).
create table accounts_receivable_projected (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references forecast_versions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  -- When the sale happens (from forecast_entries)
  ano_venda integer not null,
  mes_venda integer not null,
  dia_venda integer not null default 15, -- assumed mid-month for simplicity
  -- Calculated: when it settles (data_vencimento in AR terms)
  data_vencimento date not null,
  -- Payment method breakdown
  modalidade text not null,
  valor_bruto numeric not null check (valor_bruto >= 0),
  taxa_aplicada numeric not null default 0, -- e.g., 2.5% card fee
  valor_liquido numeric not null check (valor_liquido >= 0),
  parcelas integer not null default 1 check (parcelas >= 1),
  created_at timestamptz not null default now()
);

create index accounts_receivable_projected_version_id_idx on accounts_receivable_projected(version_id);
create index accounts_receivable_projected_org_id_idx on accounts_receivable_projected(org_id);
create index accounts_receivable_projected_data_vencimento_idx on accounts_receivable_projected(data_vencimento);

alter table accounts_receivable_projected enable row level security;

create policy "members can read accounts_receivable_projected in their org" on accounts_receivable_projected
  for select using (is_org_member(org_id));
