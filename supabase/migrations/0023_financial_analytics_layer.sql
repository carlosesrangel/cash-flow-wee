-- Migration 0023: Financial Analytics Layer
-- Purpose: Create tables and views for fee rates, seasonality, receipt profiles
-- This layer implements financial model parity with legacy Excel/Power Query
--
-- Implements:
-- - Taxas_12M (12-month historical fee rates)
-- - Sazonalidade_3Faixas (3-band seasonality profile)
-- - Perfil_Recebimento_12M (receipt timing distribution)
-- - Future receivables from existing sales
-- - Ledger foundation for cash flow

-- ============================================================
-- 1. SUMUP FEE RATES (Taxas_12M)
-- ============================================================
-- Historical fee aggregation for last 12 months
-- Dimensions: payment_type, card_type, installment_count, entry_mode, payout_plan

create table sumup_fee_rates_12m (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- Dimension keys
  payment_type text not null,
  card_type text not null,
  nro_parcelas_modelo integer not null,
  entry_mode text not null,
  payout_plan text not null,

  -- Aggregated metrics
  qtd_transacoes_12m integer not null default 0,
  valor_bruto_12m numeric not null default 0,
  qtd_com_fee integer not null default 0,
  valor_base_taxa_12m numeric not null default 0,
  fee_total_12m numeric not null default 0,

  -- Derived rates
  taxa_media_simples numeric,
  taxa_media_ponderada numeric,
  pct_valor_12m numeric,
  pct_transacoes_12m numeric,

  -- Metadata
  confiabilidade text, -- ALTA (>=30), MEDIA (>=10), BAIXA (<10)
  inicio_janela date not null,
  fim_janela date not null,

  -- Audit
  calculado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  versao text not null default 'FINANCIAL_MODEL_V2_EXCEL_PARITY',

  -- Constraints
  unique(org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan),
  constraint taxa_media_ponderada_positive check (taxa_media_ponderada is null or taxa_media_ponderada >= 0),
  constraint confiabilidade_valid check (confiabilidade in ('ALTA', 'MEDIA', 'BAIXA'))
);

create index sumup_fee_rates_12m_org_id_idx on sumup_fee_rates_12m(org_id);
create index sumup_fee_rates_12m_payment_type_idx on sumup_fee_rates_12m(org_id, payment_type);
alter table sumup_fee_rates_12m enable row level security;

create policy "members can read sumup_fee_rates_12m in their org" on sumup_fee_rates_12m for select
  using (is_org_member(org_id));

-- ============================================================
-- 2. SUMUP SEASONALITY (Sazonalidade_3Faixas)
-- ============================================================
-- 3-band intra-month seasonality distribution
-- Bands: 1-9, 10-19, 20-end

create table sumup_seasonality_3bands_12m (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- Month/Year and band
  ano_historico integer not null,
  mes_historico integer not null check (mes_historico >= 1 and mes_historico <= 12),
  faixa integer not null check (faixa in (1, 2, 3)), -- 1: 1-9, 2: 10-19, 3: 20-end

  -- Historical data
  receita_historica_faixa numeric not null default 0,
  receita_historica_mes numeric not null default 0,

  -- Derived weight
  peso_faixa numeric not null, -- receita_faixa / receita_mes, or 1/3 if mes zero

  -- Reference day for the band
  dia_referencia integer not null check (dia_referencia in (1, 10, 20)),

  -- Metadata
  inicio_janela date not null,
  fim_janela date not null,
  calculado_em timestamptz not null default now(),
  versao text not null default 'FINANCIAL_MODEL_V2_EXCEL_PARITY',

  -- Constraints
  unique(org_id, ano_historico, mes_historico, faixa),
  constraint peso_faixa_valid check (peso_faixa >= 0 and peso_faixa <= 1)
);

create index sumup_seasonality_3bands_org_id_idx on sumup_seasonality_3bands_12m(org_id);
create index sumup_seasonality_3bands_month_idx on sumup_seasonality_3bands_12m(org_id, mes_historico);
alter table sumup_seasonality_3bands_12m enable row level security;

create policy "members can read sumup_seasonality_3bands_12m in their org" on sumup_seasonality_3bands_12m for select
  using (is_org_member(org_id));

-- ============================================================
-- 3. SUMUP RECEIPT PROFILE (Perfil_Recebimento_12M)
-- ============================================================
-- Historical timing distribution of how long it takes to receive payment
-- by payment modality

create table sumup_receipt_profile_12m (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- Dimension keys (same as fee rates)
  payment_type text not null,
  card_type text not null,
  nro_parcelas_modelo integer not null,
  entry_mode text not null,
  payout_plan text not null,

  -- Receipt timing (months until money arrives)
  meses_ate_receber integer not null check (meses_ate_receber >= 0),

  -- Historical distribution
  valor_recebido_historico numeric not null default 0,
  qtd_recebimentos integer not null default 0,
  total_recebido_modalidade numeric not null,

  -- Percentage of modal that comes at this timing
  pct_recebimento_modalidade numeric not null check (pct_recebimento_modalidade >= 0 and pct_recebimento_modalidade <= 1),

  -- Metadata
  inicio_janela date not null,
  fim_janela date not null,
  calculado_em timestamptz not null default now(),
  versao text not null default 'FINANCIAL_MODEL_V2_EXCEL_PARITY',

  -- Constraints
  unique(org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan, meses_ate_receber)
);

create index sumup_receipt_profile_12m_org_id_idx on sumup_receipt_profile_12m(org_id);
create index sumup_receipt_profile_12m_timing_idx on sumup_receipt_profile_12m(org_id, meses_ate_receber);
alter table sumup_receipt_profile_12m enable row level security;

create policy "members can read sumup_receipt_profile_12m in their org" on sumup_receipt_profile_12m for select
  using (is_org_member(org_id));

-- ============================================================
-- 4. SUMUP FUTURE RECEIVABLES FROM EXISTING SALES
-- ============================================================
-- Aggregates scheduled/pending/reconciled payouts from sales already made
-- These are NOT forecast; they are committed by SumUp API

create table sumup_future_receivables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sumup_transaction_id uuid not null references sumup_transactions(id) on delete cascade,
  sumup_transaction_event_id uuid references sumup_transaction_events(id) on delete cascade,

  -- Transaction info
  transaction_code text not null,
  installment_number integer,

  -- Event details from SumUp API
  event_type text not null,
  event_status text not null, -- SCHEDULED, PENDING, RECONCILED
  amount_event numeric not null,
  due_date date,
  event_date date,

  -- Fee calculation (using fallback tier system)
  taxa_projetada numeric not null,
  fonte_taxa_projetada text not null, -- COMBINACAO_EXATA, MODALIDADE_E_PARCELAS, MODALIDADE, TAXA_GLOBAL

  -- Calculated values
  valor_recebivel_bruto numeric not null,
  fee_projetado numeric not null,
  valor_recebivel_liquido numeric not null,

  -- Status classification
  situacao_recebimento text not null, -- SEM_DATA_INFORMADA, ATRASADO_OU_PENDENTE, PREVISTO_PARA_HOJE, FUTURO

  -- Metadata
  calculado_em timestamptz not null default now(),
  versao text not null default 'FINANCIAL_MODEL_V2_EXCEL_PARITY',

  -- Constraints
  unique(org_id, sumup_transaction_id, installment_number),
  constraint valor_positive check (valor_recebivel_bruto >= 0 and fee_projetado >= 0)
);

create index sumup_future_receivables_org_id_idx on sumup_future_receivables(org_id);
create index sumup_future_receivables_due_date_idx on sumup_future_receivables(org_id, due_date);
create index sumup_future_receivables_status_idx on sumup_future_receivables(org_id, event_status);
alter table sumup_future_receivables enable row level security;

create policy "members can read sumup_future_receivables in their org" on sumup_future_receivables for select
  using (is_org_member(org_id));

-- ============================================================
-- 5. FINANCIAL LEDGER (Foundation)
-- ============================================================
-- Canonical immutable ledger for all cash flow movements
-- Every entry is auditable and traceable

create table financial_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- Event dates
  event_date date not null,
  competence_date date, -- for tax/accrual purposes

  -- Amount and direction
  amount numeric not null,
  direction text not null check (direction in ('entrada', 'saida')),

  -- Classification
  nature text not null, -- OPENING_BALANCE, SUMUP_PAYOUT_ACTUAL, etc.
  source text not null, -- sumup, tiny, forecast, manual, tax, etc.
  source_id text, -- reference to originating record
  source_event_id text, -- installment_number or payout_id

  -- Status
  status text not null check (status in ('actual', 'scheduled', 'projected')),
  is_actual boolean not null default false,
  is_projected boolean not null default false,
  is_scheduled boolean not null default false,

  -- Description
  description text,

  -- Provenance
  calculation_version text not null default 'FINANCIAL_MODEL_V2_EXCEL_PARITY',
  metadata jsonb, -- flexible field for extra context

  -- Audit
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),

  -- Constraints
  constraint direction_status_check check (
    (status = 'actual' and is_actual and not is_projected and not is_scheduled) or
    (status = 'scheduled' and not is_actual and not is_projected and is_scheduled) or
    (status = 'projected' and not is_actual and is_projected and not is_scheduled)
  )
);

create index financial_ledger_org_id_idx on financial_ledger(org_id);
create index financial_ledger_event_date_idx on financial_ledger(org_id, event_date);
create index financial_ledger_competence_date_idx on financial_ledger(org_id, competence_date) where competence_date is not null;
create index financial_ledger_source_idx on financial_ledger(org_id, source, source_id);
create index financial_ledger_status_idx on financial_ledger(org_id, status);
alter table financial_ledger enable row level security;

create policy "members can read financial_ledger in their org" on financial_ledger for select
  using (is_org_member(org_id));

create policy "members can insert financial_ledger in their org" on financial_ledger for insert
  with check (is_org_member(org_id));

-- ============================================================
-- 6. TIMEZONE CONFIGURATION
-- ============================================================
-- Add timezone to organizations if not already present
-- This ensures consistent handling of "today", month boundaries, etc.

alter table organizations
  add column if not exists timezone text not null default 'America/Sao_Paulo';

-- ============================================================
-- 7. HELPER FUNCTIONS
-- ============================================================

-- Normalize string values for financial calculations
create or replace function normalize_financial_string(input text)
returns text
language plpgsql
immutable
as $$
begin
  if input is null or input = '' then
    return 'NAO_INFORMADO';
  end if;
  return upper(trim(input));
end;
$$;

-- Get current date in organization's timezone
create or replace function current_org_date(target_org_id uuid)
returns date
language plpgsql
stable
as $$
declare
  tz text;
begin
  select timezone into tz from organizations where id = target_org_id;
  if tz is null then
    tz := 'America/Sao_Paulo';
  end if;
  return (now() at time zone tz)::date;
end;
$$;

-- Calculate effective Simples rate (nominal - deduction) / RBT12
-- Used by tax projection logic
create or replace function calculate_simples_effective_rate(
  rbt12 numeric,
  nominal_rate numeric,
  deduction_amount numeric
)
returns numeric
language plpgsql
immutable
as $$
begin
  if rbt12 <= 0 then
    return 0.04; -- 4% minimum
  end if;
  return (rbt12 * nominal_rate - deduction_amount) / rbt12;
end;
$$;

-- ============================================================
-- 8. GRANTS & RLS
-- ============================================================

-- Ensure all new tables respect org_id filtering
-- (RLS policies created above)

-- Grant necessary permissions to authenticated users
-- (relies on existing auth setup; no explicit GRANT needed for app_user role)

commit;
