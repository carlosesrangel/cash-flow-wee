-- Fase 8: Tax Configuration for Simples Nacional
-- Stores organization's tax settings including:
-- - Business category (Anexo I-V)
-- - 2027 Reforma Tributária regime choice (Simples Tradicional vs Híbrido)
-- - Purchase credit percentage for Simples Híbrido

create table tax_configurations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references organizations(id) on delete cascade,

  -- Business classification
  simples_anexo text not null check (simples_anexo in ('anexo-i', 'anexo-ii', 'anexo-iii', 'anexo-iv', 'anexo-v')),

  -- 2027 Reform decision (Simples Tradicional or Simples Híbrido)
  regime_2027 text check (regime_2027 in ('simples-tradicional', 'simples-hibrido')) default 'simples-tradicional',

  -- For Simples Híbrido: percentage of purchases that are eligible for IBS/CBS credits (0-1)
  -- Default 80% (conservative estimate for retail)
  purchase_credit_percentage numeric check (purchase_credit_percentage >= 0 and purchase_credit_percentage <= 1) default 0.8,

  -- Track decision date (deadline is 2026-09-30 for 2027)
  decision_made_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id)
);

create index tax_configurations_org_id_idx on tax_configurations(org_id);

alter table tax_configurations enable row level security;

create policy "members can read tax_configurations in their org" on tax_configurations
  for select using (is_org_member(org_id));

create policy "members can update tax_configurations in their org" on tax_configurations
  for update using (is_org_member(org_id));

create policy "members can insert tax_configurations in their org" on tax_configurations
  for insert with check (is_org_member(org_id));

-- Trigger to update updated_at timestamp
create or replace function update_tax_configurations_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tax_configurations_update_timestamp
  before update on tax_configurations
  for each row
  execute function update_tax_configurations_updated_at();
