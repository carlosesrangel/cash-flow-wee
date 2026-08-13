create table sumup_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  transaction_code text not null,
  transaction_id text,
  amount numeric,
  currency text,
  timestamp_utc timestamptz,
  status text,
  simple_status text,
  payment_type text,
  card_type text,
  entry_mode text,
  installments_count integer,
  auth_code text,
  vat_amount numeric,
  tip_amount numeric,
  fee_amount numeric,
  payouts_total numeric,
  payouts_received numeric,
  payout_plan text,
  payout_date date,
  payout_type text,
  refunded_amount numeric,
  product_summary text,
  username text,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, transaction_code)
);

create table sumup_transaction_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  transaction_id uuid not null references sumup_transactions(id) on delete cascade,
  sumup_event_id text,
  event_type text not null,
  status text not null,
  amount numeric,
  event_date date,
  due_date date,
  event_timestamp timestamptz,
  installment_number integer,
  raw jsonb not null,
  synced_at timestamptz not null default now()
);

create table sumup_payouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sumup_payout_id bigint not null,
  type text not null,
  amount numeric,
  currency text,
  payout_date date,
  fee numeric,
  status text,
  reference text,
  transaction_code text,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, sumup_payout_id)
);

create index sumup_transactions_org_id_idx on sumup_transactions(org_id);
create index sumup_transaction_events_org_id_idx on sumup_transaction_events(org_id);
create index sumup_transaction_events_transaction_id_idx on sumup_transaction_events(transaction_id);
create index sumup_payouts_org_id_idx on sumup_payouts(org_id);
create index sumup_payouts_payout_date_idx on sumup_payouts(payout_date);

alter table sumup_transactions enable row level security;
alter table sumup_transaction_events enable row level security;
alter table sumup_payouts enable row level security;

create policy "members can read sumup_transactions in their org" on sumup_transactions for select using (is_org_member(org_id));
create policy "members can read sumup_transaction_events in their org" on sumup_transaction_events for select using (is_org_member(org_id));
create policy "members can read sumup_payouts in their org" on sumup_payouts for select using (is_org_member(org_id));
