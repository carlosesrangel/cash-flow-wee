create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('olist', 'sumup')),
  client_id text,
  client_secret text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  status text not null default 'desconectado' check (status in ('desconectado', 'conectado', 'precisa_reautorizar')),
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (org_id, provider)
);

alter table integration_connections enable row level security;
-- No SELECT/INSERT/UPDATE/DELETE policies for anon/authenticated on purpose:
-- only service_role (server-only) may touch this table. The UI reads status
-- through a server-side helper using the service-role client, never a
-- client-side Supabase query against this table.

create table olist_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_id bigint not null,
  nome text,
  codigo text,
  fantasia text,
  tipo_pessoa text,
  cpf_cnpj text,
  inscricao_estadual text,
  telefone text,
  celular text,
  email text,
  endereco jsonb,
  vendedor_olist_id bigint,
  situacao text,
  status_crm text,
  data_criacao_olist timestamptz,
  data_atualizacao_olist timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, olist_id)
);

create table olist_sellers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_id bigint not null,
  nome text,
  contato_olist_id bigint,
  situacao text,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, olist_id)
);

create table olist_payment_methods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_id bigint not null,
  nome text,
  situacao text,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, olist_id)
);

create table olist_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_id bigint not null,
  sku text,
  descricao text,
  tipo text,
  situacao text,
  unidade text,
  gtin text,
  tipo_variacao text,
  precos jsonb,
  estoque jsonb,
  data_criacao_olist timestamptz,
  data_atualizacao_olist timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, olist_id)
);

create table olist_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_id bigint not null,
  numero_pedido integer,
  situacao integer,
  origem_pedido integer,
  data date,
  data_criacao_olist timestamptz,
  data_prevista date,
  data_entrega date,
  data_faturamento timestamptz,
  id_nota_fiscal bigint,
  valor_total_produtos numeric,
  valor_total_pedido numeric,
  valor_desconto numeric,
  valor_frete numeric,
  valor_outras_despesas numeric,
  numero_ordem_compra text,
  observacoes text,
  observacoes_internas text,
  cliente_olist_id bigint,
  vendedor_olist_id bigint,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, olist_id)
);

create table olist_order_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  order_id uuid not null references olist_orders(id) on delete cascade,
  produto_olist_id bigint,
  descricao_produto text,
  sku text,
  quantidade numeric,
  valor_unitario numeric,
  info_adicional text,
  raw jsonb not null,
  synced_at timestamptz not null default now()
);

create table olist_accounts_payable (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_id bigint not null,
  situacao text,
  data_emissao date,
  data_vencimento date,
  historico text,
  valor numeric,
  saldo numeric,
  numero_documento text,
  serie_documento text,
  fornecedor_olist_id bigint,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, olist_id)
);

create table olist_accounts_receivable (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_id bigint not null,
  situacao text,
  data_emissao date,
  data_vencimento date,
  historico text,
  valor numeric,
  saldo numeric,
  numero_documento text,
  numero_banco text,
  serie_documento text,
  cliente_olist_id bigint,
  quantidade_parcelas_antecipadas integer,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, olist_id)
);

-- Indexes for lookups the sync engine and future UI will do often.
create index olist_contacts_org_id_idx on olist_contacts(org_id);
create index olist_sellers_org_id_idx on olist_sellers(org_id);
create index olist_payment_methods_org_id_idx on olist_payment_methods(org_id);
create index olist_products_org_id_idx on olist_products(org_id);
create index olist_orders_org_id_idx on olist_orders(org_id);
create index olist_orders_cliente_olist_id_idx on olist_orders(cliente_olist_id);
create index olist_order_items_org_id_idx on olist_order_items(org_id);
create index olist_order_items_order_id_idx on olist_order_items(order_id);
create index olist_accounts_payable_org_id_idx on olist_accounts_payable(org_id);
create index olist_accounts_payable_vencimento_idx on olist_accounts_payable(data_vencimento);
create index olist_accounts_receivable_org_id_idx on olist_accounts_receivable(org_id);
create index olist_accounts_receivable_vencimento_idx on olist_accounts_receivable(data_vencimento);

-- RLS: read-only for org members on every synced data table (writes only via
-- service_role from the sync engine — no INSERT/UPDATE/DELETE policy for
-- anon/authenticated on any of these, matching the "no ORM, server writes
-- only" pattern already established in Fase 0+1).
alter table olist_contacts enable row level security;
alter table olist_sellers enable row level security;
alter table olist_payment_methods enable row level security;
alter table olist_products enable row level security;
alter table olist_orders enable row level security;
alter table olist_order_items enable row level security;
alter table olist_accounts_payable enable row level security;
alter table olist_accounts_receivable enable row level security;

create policy "members can read olist_contacts in their org" on olist_contacts for select using (is_org_member(org_id));
create policy "members can read olist_sellers in their org" on olist_sellers for select using (is_org_member(org_id));
create policy "members can read olist_payment_methods in their org" on olist_payment_methods for select using (is_org_member(org_id));
create policy "members can read olist_products in their org" on olist_products for select using (is_org_member(org_id));
create policy "members can read olist_orders in their org" on olist_orders for select using (is_org_member(org_id));
create policy "members can read olist_order_items in their org" on olist_order_items for select using (is_org_member(org_id));
create policy "members can read olist_accounts_payable in their org" on olist_accounts_payable for select using (is_org_member(org_id));
create policy "members can read olist_accounts_receivable in their org" on olist_accounts_receivable for select using (is_org_member(org_id));
