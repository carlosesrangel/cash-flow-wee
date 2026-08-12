# WEE Cash Flow — Fase 2 (Integração Olist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the WEE app to the Olist ERP API V3 via OAuth2, sync orders/contacts/accounts-payable/accounts-receivable/products/sellers/payment-methods into Postgres, and surface real sync status on the Integrações page — all read-only, no financial calculations yet.

**Architecture:** Server-only OAuth2 client (Keycloak-based, per Olist's real flow) exchanges/refreshes tokens and stores them in a `service_role`-only table. A generic paginate-and-upsert helper backs one sync function per entity, each writing to its own `olist_*` table and logging a `sync_runs` row. A route handler triggers sync manually (RBAC-gated); the Integrações page reads connection status and recent runs.

**Tech Stack:** Same as Fase 0+1 — Next.js 16 App Router, TypeScript strict, Supabase (Postgres/RLS via hand-written SQL migrations, no ORM), Zod, Vitest. No Playwright e2e for the OAuth flow itself (it requires a real human login at Olist — cannot be automated safely); covered instead by unit/integration tests against fixtures plus one documented manual verification pass.

## Global Constraints

- Base API URL: `https://api.tiny.com.br/public-api/v3`. Bearer token auth.
- OAuth2 authorize: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth` (`client_id`, `redirect_uri`, `scope=openid`, `response_type=code`).
- OAuth2 token: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token` (`grant_type=authorization_code` for the initial exchange; `grant_type=refresh_token` for renewal).
- Access token expires in 4 hours. Refresh token expires in 1 day — if a sync doesn't run within that window, the connection must be marked `precisa_reautorizar`, not silently fail.
- Pagination: `limit`/`offset` query params on every list endpoint; responses shaped `{ itens: T[], paginacao: { limit, offset, total } }` (verify this exact wrapper against the swagger spec for each specific endpoint before coding — one endpoint's dump during design showed a possibly-different top-level shape; confirm empirically, do not assume).
- `/pedidos` and `/contatos` support a `dataAtualizacao` query filter for incremental sync. `/contas-pagar` and `/contas-receber` do NOT — use the sliding-window strategy (reprocess the last ~60-90 days of `dataVencimento` on every incremental run).
- `/pedidos/{idPedido}` (single order) embeds `itens`, `cliente`, `vendedor`, `pagamento` — there is no separate order-items list endpoint.
- No writes to Olist. Read-only integration only, this phase and beyond until explicitly revisited.
- Never expose `client_secret`, `access_token`, `refresh_token`, or `SUPABASE_SERVICE_ROLE_KEY` to client-side code — server-only, route handlers and Server Components only.
- `org_id` + RLS on every new table, following the Fase 0+1 pattern exactly (see `supabase/migrations/0001_foundation.sql` for the established style: `is_org_member()`/`current_org_role()` helpers, explicit `create policy`, no ORM).
- pt-BR UI copy, BRL currency, `dd/MM/yyyy` dates, `America/Sao_Paulo` timezone (reuse `lib/format/currency.ts` and `lib/format/date.ts` from Fase 0+1 — do not recreate them).
- `.env.local` already has `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET`, `OLIST_REDIRECT_URI=http://localhost:3000/integracoes/olist/callback` set. Do not commit real values anywhere.
- Local Supabase reference: API `http://127.0.0.1:55321`, DB `postgresql://postgres:postgres@127.0.0.1:55322/postgres`, Studio `http://127.0.0.1:55323`. Confirm `docker ps` shows `supabase_..._fase0-1-fundacao`-prefixed containers (or whatever the current project's container prefix is) running healthy before starting any task; if not, `npx supabase start` from the project root.
- Commit after every task.

---

### Task 1: Database schema — `integration_connections` and `olist_*` tables

**Files:**
- Create: `supabase/migrations/0007_olist_integration.sql`

**Interfaces:**
- Produces: tables `integration_connections`, `olist_contacts`, `olist_sellers`, `olist_payment_methods`, `olist_products`, `olist_orders`, `olist_order_items`, `olist_accounts_payable`, `olist_accounts_receivable`. Every later task's SQL/TypeScript column references must match this migration exactly.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_olist_integration.sql`:
```sql
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
```

- [ ] **Step 2: Apply and verify**

Run: `npx supabase db reset`
Expected: all migrations (0001-0007) apply cleanly. Verify with a query (e.g. via `npx supabase db query` or Studio) that all 9 new tables exist and `integration_connections` truly has zero RLS policies (`select * from pg_policies where tablename = 'integration_connections';` returns 0 rows).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_olist_integration.sql
git commit -m "feat: add integration_connections and olist_* schema with RLS"
```

---

### Task 2: Service-role Supabase client for server-only writes

**Files:**
- Create: `lib/supabase/admin.ts`
- Test: `tests/unit/supabase/admin.test.ts`

**Interfaces:**
- Consumes: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` from `process.env`.
- Produces: `createAdminSupabaseClient(): SupabaseClient` — a service-role client that bypasses RLS. Consumed by every sync function (Tasks 8-13) and the OAuth callback (Task 5) to write `integration_connections` and `olist_*` rows. **Must never be imported by any file under a client component boundary (`'use client'`) or any code that could end up in a browser bundle.**

- [ ] **Step 1: Write a test asserting the module only reads server env vars and never a `NEXT_PUBLIC_`-prefixed service key**

Create `tests/unit/supabase/admin.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('createAdminSupabaseClient', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('creates a client without throwing when both env vars are set', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    expect(() => createAdminSupabaseClient()).not.toThrow()
  })

  it('throws a clear error when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    expect(() => createAdminSupabaseClient()).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- supabase/admin`
Expected: FAIL — `Cannot find module '@/lib/supabase/admin'`

- [ ] **Step 3: Implement the admin client**

Create `lib/supabase/admin.ts`:
```typescript
import { createClient } from '@supabase/supabase-js'

export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'createAdminSupabaseClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- supabase/admin`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/admin.ts tests/unit/supabase/admin.test.ts
git commit -m "feat: add service-role Supabase admin client for server-only writes"
```

---

### Task 3: OAuth2 CSRF state signing

**Files:**
- Create: `lib/olist/state.ts`
- Test: `tests/unit/olist/state.test.ts`

**Interfaces:**
- Produces: `signState(payload: { orgId: string }): string`, `verifyState(token: string): { orgId: string } | null` — consumed by Task 5 (connect route signs, callback route verifies).

- [ ] **Step 1: Write failing tests**

Create `tests/unit/olist/state.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('signState / verifyState', () => {
  beforeEach(() => {
    process.env.OLIST_STATE_SECRET = 'test-secret-at-least-32-characters-long'
  })

  it('round-trips a valid payload', async () => {
    const { signState, verifyState } = await import('@/lib/olist/state')
    const token = signState({ orgId: '00000000-0000-0000-0000-000000000001' })
    const result = verifyState(token)
    expect(result).toEqual({ orgId: '00000000-0000-0000-0000-000000000001' })
  })

  it('rejects a tampered token', async () => {
    const { signState, verifyState } = await import('@/lib/olist/state')
    const token = signState({ orgId: '00000000-0000-0000-0000-000000000001' })
    const tampered = token.slice(0, -2) + 'xx'
    expect(verifyState(tampered)).toBeNull()
  })

  it('rejects garbage input', async () => {
    const { verifyState } = await import('@/lib/olist/state')
    expect(verifyState('not-a-real-token')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/state`
Expected: FAIL — `Cannot find module '@/lib/olist/state'`

- [ ] **Step 3: Implement HMAC-signed state**

Create `lib/olist/state.ts`:
```typescript
import { createHmac, timingSafeEqual } from 'crypto'

type StatePayload = { orgId: string }

function getSecret(): string {
  const secret = process.env.OLIST_STATE_SECRET
  if (!secret) {
    throw new Error('OLIST_STATE_SECRET must be set')
  }
  return secret
}

export function signState(payload: StatePayload): string {
  const json = JSON.stringify(payload)
  const encoded = Buffer.from(json, 'utf8').toString('base64url')
  const signature = createHmac('sha256', getSecret()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifyState(token: string): StatePayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [encoded, signature] = parts

  const expectedSignature = createHmac('sha256', getSecret()).update(encoded).digest('base64url')

  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null
  }

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8')
    const payload = JSON.parse(json)
    if (typeof payload.orgId !== 'string') return null
    return { orgId: payload.orgId }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/state`
Expected: PASS (3 tests)

- [ ] **Step 5: Add `OLIST_STATE_SECRET` to `.env.example`**

Add to `.env.example` under the Olist section:
```bash
OLIST_STATE_SECRET=
```
Add a generated random value (e.g. `openssl rand -base64 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) to the local `.env.local` (not committed).

- [ ] **Step 6: Commit**

```bash
git add lib/olist/state.ts tests/unit/olist/state.test.ts .env.example
git commit -m "feat: add HMAC-signed OAuth2 state helper for CSRF protection"
```

---

### Task 4: OAuth2 client (authorize URL, token exchange, refresh)

**Files:**
- Create: `lib/olist/oauth.ts`
- Test: `tests/unit/olist/oauth.test.ts`

**Interfaces:**
- Consumes: `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET`, `OLIST_REDIRECT_URI` from `process.env`; `signState`/`verifyState` from Task 3.
- Produces: `buildAuthorizeUrl(orgId: string): string`, `exchangeCodeForTokens(code: string): Promise<OlistTokens>`, `refreshTokens(refreshToken: string): Promise<OlistTokens>`, type `OlistTokens = { accessToken: string; refreshToken: string; expiresAt: Date }`. Consumed by Task 5 (connect/callback routes) and Task 6 (authenticated client's auto-refresh).

- [ ] **Step 1: Write failing tests using mocked `fetch`**

Create `tests/unit/olist/oauth.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('olist oauth client', () => {
  beforeEach(() => {
    process.env.OLIST_CLIENT_ID = 'test-client-id'
    process.env.OLIST_CLIENT_SECRET = 'test-client-secret'
    process.env.OLIST_REDIRECT_URI = 'http://localhost:3000/integracoes/olist/callback'
    process.env.OLIST_STATE_SECRET = 'test-secret-at-least-32-characters-long'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('builds an authorize URL with the required query params', async () => {
    const { buildAuthorizeUrl } = await import('@/lib/olist/oauth')
    const url = new URL(buildAuthorizeUrl('00000000-0000-0000-0000-000000000001'))
    expect(url.origin + url.pathname).toBe(
      'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth'
    )
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/integracoes/olist/callback'
    )
    expect(url.searchParams.get('scope')).toBe('openid')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBeTruthy()
  })

  it('exchanges an authorization code for tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 14400,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { exchangeCodeForTokens } = await import('@/lib/olist/oauth')
    const tokens = await exchangeCodeForTokens('auth-code-abc')

    expect(tokens.accessToken).toBe('access-123')
    expect(tokens.refreshToken).toBe('refresh-456')
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code-abc')
    expect(body.get('client_id')).toBe('test-client-id')
    expect(body.get('client_secret')).toBe('test-client-secret')
  })

  it('throws when the token endpoint returns an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' })
    vi.stubGlobal('fetch', fetchMock)

    const { exchangeCodeForTokens } = await import('@/lib/olist/oauth')
    await expect(exchangeCodeForTokens('bad-code')).rejects.toThrow()
  })

  it('refreshes tokens using grant_type=refresh_token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-789',
        refresh_token: 'refresh-000',
        expires_in: 14400,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { refreshTokens } = await import('@/lib/olist/oauth')
    const tokens = await refreshTokens('old-refresh-token')

    expect(tokens.accessToken).toBe('access-789')
    const [, init] = fetchMock.mock.calls[0]
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('old-refresh-token')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/oauth`
Expected: FAIL — `Cannot find module '@/lib/olist/oauth'`

- [ ] **Step 3: Implement the OAuth2 client**

Create `lib/olist/oauth.ts`:
```typescript
import { signState } from '@/lib/olist/state'

const AUTHORIZE_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth'
const TOKEN_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token'

export type OlistTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

function getEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set`)
  return value
}

export function buildAuthorizeUrl(orgId: string): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', getEnv('OLIST_CLIENT_ID'))
  url.searchParams.set('redirect_uri', getEnv('OLIST_REDIRECT_URI'))
  url.searchParams.set('scope', 'openid')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', signState({ orgId }))
  return url.toString()
}

async function requestTokens(body: URLSearchParams): Promise<OlistTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Olist token request failed (${response.status}): ${detail}`)
  }

  const data = await response.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}

export async function exchangeCodeForTokens(code: string): Promise<OlistTokens> {
  return requestTokens(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: getEnv('OLIST_CLIENT_ID'),
      client_secret: getEnv('OLIST_CLIENT_SECRET'),
      redirect_uri: getEnv('OLIST_REDIRECT_URI'),
      code,
    })
  )
}

export async function refreshTokens(refreshToken: string): Promise<OlistTokens> {
  return requestTokens(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: getEnv('OLIST_CLIENT_ID'),
      client_secret: getEnv('OLIST_CLIENT_SECRET'),
      refresh_token: refreshToken,
    })
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/oauth`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/olist/oauth.ts tests/unit/olist/oauth.test.ts
git commit -m "feat: add Olist OAuth2 client (authorize URL, code exchange, refresh)"
```

---

### Task 5: Connect and callback route handlers

**Files:**
- Create: `app/api/integracoes/olist/connect/route.ts`, `app/integracoes/olist/callback/route.ts`

**Interfaces:**
- Consumes: `getCurrentMember()` (`lib/auth/session.ts`), `canManageIntegrations()` (`lib/auth/rbac.ts`), `buildAuthorizeUrl`/`exchangeCodeForTokens` (Task 4), `verifyState` (Task 3), `createAdminSupabaseClient` (Task 2).
- Produces: `GET /api/integracoes/olist/connect` (redirects to Olist), `GET /integracoes/olist/callback` (handles the OAuth return, upserts `integration_connections`).

- [ ] **Step 1: Implement the connect route**

Create `app/api/integracoes/olist/connect/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { buildAuthorizeUrl } from '@/lib/olist/oauth'

export async function GET() {
  const member = await getCurrentMember()

  if (!member || !canManageIntegrations(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  return NextResponse.redirect(buildAuthorizeUrl(member.orgId))
}
```

- [ ] **Step 2: Implement the callback route**

Create `app/integracoes/olist/callback/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { verifyState } from '@/lib/olist/state'
import { exchangeCodeForTokens } from '@/lib/olist/oauth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const stateToken = searchParams.get('state')

  const state = stateToken ? verifyState(stateToken) : null

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/integracoes?olist_erro=estado_invalido`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const admin = createAdminSupabaseClient()

    const { error } = await admin.from('integration_connections').upsert(
      {
        org_id: state.orgId,
        provider: 'olist',
        client_id: process.env.OLIST_CLIENT_ID,
        client_secret: process.env.OLIST_CLIENT_SECRET,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt.toISOString(),
        status: 'conectado',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,provider' }
    )

    if (error) throw error
  } catch {
    return NextResponse.redirect(`${origin}/integracoes?olist_erro=falha_conexao`)
  }

  return NextResponse.redirect(`${origin}/integracoes?olist_conectado=1`)
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 4: Manual verification (documented, not automated — requires real Olist login)**

With `npm run dev` running and `.env.local` populated with real `OLIST_CLIENT_ID`/`OLIST_CLIENT_SECRET`/`OLIST_STATE_SECRET`, log in to the app as `test@wee.com.br`, then visit `http://localhost:3000/api/integracoes/olist/connect`. Confirm it redirects to the Olist login/authorization screen, and after authorizing, redirects back to `/integracoes?olist_conectado=1`. Verify via Supabase Studio (`http://127.0.0.1:55323`) that `integration_connections` has one row with `provider='olist'`, `status='conectado'`, and non-null `access_token`/`refresh_token`.

- [ ] **Step 5: Commit**

```bash
git add app/api/integracoes/olist/connect app/integracoes/olist/callback
git commit -m "feat: add Olist OAuth2 connect and callback route handlers"
```

---

### Task 6: Authenticated Olist API client (auto-refresh, retry/backoff)

**Files:**
- Create: `lib/olist/client.ts`
- Test: `tests/unit/olist/client.test.ts`

**Interfaces:**
- Consumes: `refreshTokens` (Task 4), `createAdminSupabaseClient` (Task 2).
- Produces: `getValidConnection(orgId: string): Promise<{ accessToken: string } | null>` (returns null and marks `precisa_reautorizar` if refresh fails), `olistFetch<T>(orgId: string, path: string, query?: Record<string, string | number | undefined>): Promise<T>` — consumed by every sync function (Tasks 8-13) and the pagination helper (Task 7).

- [ ] **Step 1: Write failing tests**

Create `tests/unit/olist/client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))
vi.mock('@/lib/olist/oauth', () => ({
  refreshTokens: vi.fn(),
}))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { refreshTokens } from '@/lib/olist/oauth'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

function makeAdminMock(connectionRow: Record<string, unknown> | null) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  const single = vi.fn().mockResolvedValue({ data: connectionRow, error: null })
  const eq2 = vi.fn().mockReturnValue({ single })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn().mockReturnValue({ select, update })
  return { from }
}

describe('getValidConnection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the access token unchanged when not near expiry', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'valid-token',
      refresh_token: 'refresh-token',
      expires_at: futureExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

    const { getValidConnection } = await import('@/lib/olist/client')
    const result = await getValidConnection(ORG_ID)

    expect(result).toEqual({ accessToken: 'valid-token' })
    expect(refreshTokens).not.toHaveBeenCalled()
  })

  it('refreshes and returns the new token when near expiry', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'old-token',
      refresh_token: 'refresh-token',
      expires_at: nearExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)
    vi.mocked(refreshTokens).mockResolvedValue({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    })

    const { getValidConnection } = await import('@/lib/olist/client')
    const result = await getValidConnection(ORG_ID)

    expect(result).toEqual({ accessToken: 'new-token' })
    expect(refreshTokens).toHaveBeenCalledWith('refresh-token')
  })

  it('returns null and does not throw when refresh fails (refresh token expired)', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'old-token',
      refresh_token: 'expired-refresh-token',
      expires_at: nearExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)
    vi.mocked(refreshTokens).mockRejectedValue(new Error('invalid_grant'))

    const { getValidConnection } = await import('@/lib/olist/client')
    const result = await getValidConnection(ORG_ID)

    expect(result).toBeNull()
  })

  it('returns null when there is no connection row', async () => {
    const adminMock = makeAdminMock(null)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

    const { getValidConnection } = await import('@/lib/olist/client')
    const result = await getValidConnection(ORG_ID)

    expect(result).toBeNull()
  })
})

describe('olistFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries once on a 5xx response then succeeds', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'valid-token',
      refresh_token: 'refresh-token',
      expires_at: futureExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const { olistFetch } = await import('@/lib/olist/client')
    const result = await olistFetch<{ ok: boolean }>(ORG_ID, '/contatos', { limit: 100, offset: 0 })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting retries', async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const adminMock = makeAdminMock({
      access_token: 'valid-token',
      refresh_token: 'refresh-token',
      expires_at: futureExpiry,
      status: 'conectado',
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as never)

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'error' })
    vi.stubGlobal('fetch', fetchMock)

    const { olistFetch } = await import('@/lib/olist/client')
    await expect(olistFetch(ORG_ID, '/contatos', {})).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/client`
Expected: FAIL — `Cannot find module '@/lib/olist/client'`

- [ ] **Step 3: Implement the client**

Create `lib/olist/client.ts`:
```typescript
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { refreshTokens } from '@/lib/olist/oauth'

const API_BASE_URL = 'https://api.tiny.com.br/public-api/v3'
const EXPIRY_BUFFER_MS = 5 * 60 * 1000
const MAX_RETRIES = 3
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504])

export async function getValidConnection(orgId: string): Promise<{ accessToken: string } | null> {
  const admin = createAdminSupabaseClient()
  const { data: connection } = await admin
    .from('integration_connections')
    .select('access_token, refresh_token, expires_at, status')
    .eq('org_id', orgId)
    .eq('provider', 'olist')
    .single()

  if (!connection || !connection.access_token || !connection.refresh_token) {
    return null
  }

  const expiresAt = connection.expires_at ? new Date(connection.expires_at as string).getTime() : 0
  const needsRefresh = expiresAt - Date.now() < EXPIRY_BUFFER_MS

  if (!needsRefresh) {
    return { accessToken: connection.access_token as string }
  }

  try {
    const tokens = await refreshTokens(connection.refresh_token as string)
    await admin
      .from('integration_connections')
      .update({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt.toISOString(),
        status: 'conectado',
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', orgId)

    return { accessToken: tokens.accessToken }
  } catch {
    await admin
      .from('integration_connections')
      .update({ status: 'precisa_reautorizar', updated_at: new Date().toISOString() })
      .eq('org_id', orgId)

    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function olistFetch<T>(
  orgId: string,
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const connection = await getValidConnection(orgId)
  if (!connection) {
    throw new Error(`Olist connection unavailable for org ${orgId} — reauthorization required`)
  }

  const url = new URL(`${API_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${connection.accessToken}` },
    })

    if (response.ok) {
      return (await response.json()) as T
    }

    const detail = await response.text()
    lastError = new Error(`Olist API request failed (${response.status}) for ${path}: ${detail}`)

    if (!RETRY_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES - 1) {
      throw lastError
    }

    await sleep(2 ** attempt * 500)
  }

  throw lastError ?? new Error(`Olist API request failed for ${path}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/client`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/olist/client.ts tests/unit/olist/client.test.ts
git commit -m "feat: add authenticated Olist API client with auto-refresh and retry"
```

---

### Task 7: Pagination helper and `sync_runs` logging helper

**Files:**
- Create: `lib/olist/paginate.ts`, `lib/olist/sync/run-context.ts`
- Test: `tests/unit/olist/paginate.test.ts`, `tests/unit/olist/sync/run-context.test.ts`

**Interfaces:**
- Consumes: `olistFetch` (Task 6), `createAdminSupabaseClient` (Task 2).
- Produces: `paginateOlist<T>(orgId: string, path: string, baseQuery: Record<string, string | number | undefined>, pageSize?: number): AsyncGenerator<T[]>`, `startSyncRun(orgId: string, integration: 'olist' | 'sumup'): Promise<string>` (returns `sync_runs.id`), `finishSyncRun(runId: string, result: { status: 'success' | 'failed'; recordsReceived: number; recordsCreated: number; recordsUpdated: number; errorCount: number; errorMessage?: string }): Promise<void>`. Consumed by every sync function (Tasks 8-13) and the orchestrator (Task 14).

- [ ] **Step 1: Write failing tests for pagination**

Create `tests/unit/olist/paginate.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/client', () => ({ olistFetch: vi.fn() }))
import { olistFetch } from '@/lib/olist/client'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('paginateOlist', () => {
  afterEach(() => vi.restoreAllMocks())

  it('yields every page until offset reaches the total', async () => {
    vi.mocked(olistFetch)
      .mockResolvedValueOnce({ itens: [{ id: 1 }, { id: 2 }], paginacao: { limit: 2, offset: 0, total: 3 } })
      .mockResolvedValueOnce({ itens: [{ id: 3 }], paginacao: { limit: 2, offset: 2, total: 3 } })

    const { paginateOlist } = await import('@/lib/olist/paginate')
    const pages: unknown[] = []
    for await (const page of paginateOlist(ORG_ID, '/contatos', {}, 2)) {
      pages.push(page)
    }

    expect(pages).toEqual([[{ id: 1 }, { id: 2 }], [{ id: 3 }]])
    expect(olistFetch).toHaveBeenCalledTimes(2)
    expect(olistFetch).toHaveBeenNthCalledWith(1, ORG_ID, '/contatos', { limit: 2, offset: 0 })
    expect(olistFetch).toHaveBeenNthCalledWith(2, ORG_ID, '/contatos', { limit: 2, offset: 2 })
  })

  it('stops immediately when the first page is empty', async () => {
    vi.mocked(olistFetch).mockResolvedValueOnce({ itens: [], paginacao: { limit: 100, offset: 0, total: 0 } })

    const { paginateOlist } = await import('@/lib/olist/paginate')
    const pages: unknown[] = []
    for await (const page of paginateOlist(ORG_ID, '/contatos', {}, 100)) {
      pages.push(page)
    }

    expect(pages).toEqual([[]])
    expect(olistFetch).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/paginate`
Expected: FAIL — module not found

- [ ] **Step 3: Implement pagination helper**

Create `lib/olist/paginate.ts`:
```typescript
import { olistFetch } from '@/lib/olist/client'

type PaginatedResponse<T> = {
  itens: T[]
  paginacao: { limit: number; offset: number; total: number }
}

export async function* paginateOlist<T>(
  orgId: string,
  path: string,
  baseQuery: Record<string, string | number | undefined>,
  pageSize = 100
): AsyncGenerator<T[]> {
  let offset = 0

  while (true) {
    const page = await olistFetch<PaginatedResponse<T>>(orgId, path, {
      ...baseQuery,
      limit: pageSize,
      offset,
    })

    yield page.itens

    offset += pageSize
    if (offset >= page.paginacao.total) break
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/paginate`
Expected: PASS (2 tests)

- [ ] **Step 5: Write failing tests for sync_runs helpers**

Create `tests/unit/olist/sync/run-context.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('startSyncRun / finishSyncRun', () => {
  afterEach(() => vi.restoreAllMocks())

  it('inserts a running row and returns its id', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'run-1' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const from = vi.fn().mockReturnValue({ insert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { startSyncRun } = await import('@/lib/olist/sync/run-context')
    const runId = await startSyncRun(ORG_ID, 'olist')

    expect(runId).toBe('run-1')
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, integration: 'olist', status: 'running' })
    )
  })

  it('updates the row with final counts on finish', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { finishSyncRun } = await import('@/lib/olist/sync/run-context')
    await finishSyncRun('run-1', {
      status: 'success',
      recordsReceived: 10,
      recordsCreated: 8,
      recordsUpdated: 2,
      errorCount: 0,
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        records_received: 10,
        records_created: 8,
        records_updated: 2,
        error_count: 0,
      })
    )
    expect(eq).toHaveBeenCalledWith('id', 'run-1')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- olist/sync/run-context`
Expected: FAIL — module not found

- [ ] **Step 7: Implement sync_runs helpers**

Create `lib/olist/sync/run-context.ts`:
```typescript
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export type SyncRunResult = {
  status: 'success' | 'failed'
  recordsReceived: number
  recordsCreated: number
  recordsUpdated: number
  errorCount: number
  errorMessage?: string
}

export async function startSyncRun(orgId: string, integration: 'olist' | 'sumup'): Promise<string> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin
    .from('sync_runs')
    .insert({ org_id: orgId, integration, status: 'running' })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to start sync run: ${error?.message ?? 'unknown error'}`)
  }

  return data.id as string
}

export async function finishSyncRun(runId: string, result: SyncRunResult): Promise<void> {
  const admin = createAdminSupabaseClient()
  const { error } = await admin
    .from('sync_runs')
    .update({
      status: result.status,
      finished_at: new Date().toISOString(),
      records_received: result.recordsReceived,
      records_created: result.recordsCreated,
      records_updated: result.recordsUpdated,
      error_count: result.errorCount,
      error_message: result.errorMessage ?? null,
    })
    .eq('id', runId)

  if (error) {
    throw new Error(`Failed to finish sync run ${runId}: ${error.message}`)
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -- olist/sync/run-context`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add lib/olist/paginate.ts lib/olist/sync/run-context.ts tests/unit/olist/paginate.test.ts tests/unit/olist/sync/run-context.test.ts
git commit -m "feat: add pagination helper and sync_runs logging helpers"
```

---

### Task 8: Sync sellers and payment methods (reference data)

**Files:**
- Create: `lib/olist/sync/sellers.ts`, `lib/olist/sync/payment-methods.ts`
- Test: `tests/unit/olist/sync/sellers.test.ts`, `tests/unit/olist/sync/payment-methods.test.ts`

**Interfaces:**
- Consumes: `paginateOlist` (Task 7), `createAdminSupabaseClient` (Task 2).
- Produces: `syncSellers(orgId: string): Promise<{ received: number; created: number; updated: number }>`, `syncPaymentMethods(orgId: string): Promise<{ received: number; created: number; updated: number }>` — consumed by the orchestrator (Task 14).

- [ ] **Step 1: Write failing test for sellers sync**

Create `tests/unit/olist/sync/sellers.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncSellers', () => {
  afterEach(() => vi.restoreAllMocks())

  it('upserts every seller across all pages and reports counts', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [{ id: 1, nome: 'Ana', situacao: 'A' }],
        [{ id: 2, nome: 'Bruno', situacao: 'A' }],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null, count: 1 })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncSellers } = await import('@/lib/olist/sync/sellers')
    const result = await syncSellers(ORG_ID)

    expect(result.received).toBe(2)
    expect(from).toHaveBeenCalledWith('olist_sellers')
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert.mock.calls[0][0]).toMatchObject([
      { org_id: ORG_ID, olist_id: 1, nome: 'Ana', situacao: 'A' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/sync/sellers`
Expected: FAIL — module not found

- [ ] **Step 3: Implement sellers sync**

Create `lib/olist/sync/sellers.ts`:
```typescript
import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistSeller = {
  id: number
  nome: string | null
  situacao: string | null
  contato?: { id: number } | null
}

export async function syncSellers(orgId: string): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  for await (const page of paginateOlist<OlistSeller>(orgId, '/vendedores', {})) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((seller) => ({
      org_id: orgId,
      olist_id: seller.id,
      nome: seller.nome,
      situacao: seller.situacao,
      contato_olist_id: seller.contato?.id ?? null,
      raw: seller,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_sellers').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_sellers: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/sync/sellers`
Expected: PASS (1 test)

- [ ] **Step 5: Write failing test for payment methods sync**

Create `tests/unit/olist/sync/payment-methods.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncPaymentMethods', () => {
  afterEach(() => vi.restoreAllMocks())

  it('upserts every payment method and reports counts', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([[{ id: 1, nome: 'Boleto', situacao: 'A' }]]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncPaymentMethods } = await import('@/lib/olist/sync/payment-methods')
    const result = await syncPaymentMethods(ORG_ID)

    expect(result.received).toBe(1)
    expect(from).toHaveBeenCalledWith('olist_payment_methods')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- olist/sync/payment-methods`
Expected: FAIL — module not found

- [ ] **Step 7: Implement payment methods sync**

Create `lib/olist/sync/payment-methods.ts`:
```typescript
import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistPaymentMethod = {
  id: number
  nome: string | null
  situacao: string | null
}

export async function syncPaymentMethods(
  orgId: string
): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  for await (const page of paginateOlist<OlistPaymentMethod>(orgId, '/formas-pagamento', {})) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((method) => ({
      org_id: orgId,
      olist_id: method.id,
      nome: method.nome,
      situacao: method.situacao,
      raw: method,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_payment_methods').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_payment_methods: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -- olist/sync/payment-methods`
Expected: PASS (1 test)

- [ ] **Step 9: Commit**

```bash
git add lib/olist/sync/sellers.ts lib/olist/sync/payment-methods.ts tests/unit/olist/sync/sellers.test.ts tests/unit/olist/sync/payment-methods.test.ts
git commit -m "feat: add sync for Olist sellers and payment methods reference data"
```

---

### Task 9: Sync contacts (incremental via `dataAtualizacao`)

**Files:**
- Create: `lib/olist/sync/contacts.ts`
- Test: `tests/unit/olist/sync/contacts.test.ts`

**Interfaces:**
- Consumes: `paginateOlist` (Task 7), `createAdminSupabaseClient` (Task 2).
- Produces: `syncContacts(orgId: string, options?: { since?: Date }): Promise<{ received: number; created: number; updated: number }>` — consumed by the orchestrator (Task 14). Passing `since` filters via the API's `dataAtualizacao` param for incremental runs; omitting it does a full sync.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/olist/sync/contacts.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncContacts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps and upserts contacts, tolerating missing optional fields', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 10,
            nome: 'Cliente Um',
            codigo: 'C001',
            situacao: 'A',
            statusCrm: 'C',
            dataCriacao: '2026-01-01',
            dataAtualizacao: '2026-01-05',
            vendedor: { id: 1, nome: 'Ana' },
          },
          {
            id: 11,
            nome: 'Cliente Sem Vendedor',
            situacao: 'B',
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncContacts } = await import('@/lib/olist/sync/contacts')
    const result = await syncContacts(ORG_ID)

    expect(result.received).toBe(2)
    const upsertedRows = upsert.mock.calls[0][0]
    expect(upsertedRows[0]).toMatchObject({ org_id: ORG_ID, olist_id: 10, vendedor_olist_id: 1 })
    expect(upsertedRows[1]).toMatchObject({ org_id: ORG_ID, olist_id: 11, vendedor_olist_id: null })
  })

  it('passes dataAtualizacao to paginateOlist when since is provided', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncContacts } = await import('@/lib/olist/sync/contacts')
    await syncContacts(ORG_ID, { since: new Date('2026-06-01T00:00:00Z') })

    expect(paginateOlist).toHaveBeenCalledWith(
      ORG_ID,
      '/contatos',
      expect.objectContaining({ dataAtualizacao: '2026-06-01' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/sync/contacts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement contacts sync**

Create `lib/olist/sync/contacts.ts`:
```typescript
import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistContact = {
  id: number
  nome: string | null
  codigo?: string | null
  fantasia?: string | null
  tipoPessoa?: string | null
  cpfCnpj?: string | null
  inscricaoEstadual?: string | null
  telefone?: string | null
  celular?: string | null
  email?: string | null
  endereco?: unknown
  vendedor?: { id: number } | null
  situacao?: string | null
  statusCrm?: string | null
  dataCriacao?: string | null
  dataAtualizacao?: string | null
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function syncContacts(
  orgId: string,
  options: { since?: Date } = {}
): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const query = options.since ? { dataAtualizacao: toIsoDate(options.since) } : {}

  for await (const page of paginateOlist<OlistContact>(orgId, '/contatos', query)) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((contact) => ({
      org_id: orgId,
      olist_id: contact.id,
      nome: contact.nome,
      codigo: contact.codigo ?? null,
      fantasia: contact.fantasia ?? null,
      tipo_pessoa: contact.tipoPessoa ?? null,
      cpf_cnpj: contact.cpfCnpj ?? null,
      inscricao_estadual: contact.inscricaoEstadual ?? null,
      telefone: contact.telefone ?? null,
      celular: contact.celular ?? null,
      email: contact.email ?? null,
      endereco: contact.endereco ?? null,
      vendedor_olist_id: contact.vendedor?.id ?? null,
      situacao: contact.situacao ?? null,
      status_crm: contact.statusCrm ?? null,
      data_criacao_olist: contact.dataCriacao ?? null,
      data_atualizacao_olist: contact.dataAtualizacao ?? null,
      raw: contact,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_contacts').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_contacts: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/sync/contacts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/olist/sync/contacts.ts tests/unit/olist/sync/contacts.test.ts
git commit -m "feat: add incremental Olist contacts sync"
```

---

### Task 10: Sync products

**Files:**
- Create: `lib/olist/sync/products.ts`
- Test: `tests/unit/olist/sync/products.test.ts`

**Interfaces:**
- Consumes: `paginateOlist` (Task 7), `createAdminSupabaseClient` (Task 2).
- Produces: `syncProducts(orgId: string): Promise<{ received: number; created: number; updated: number }>` — consumed by the orchestrator (Task 14).

- [ ] **Step 1: Write failing test**

Create `tests/unit/olist/sync/products.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncProducts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps and upserts products', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 100,
            sku: 'ANEL-01',
            descricao: 'Anel Prata',
            tipo: 'S',
            situacao: 'A',
            unidade: 'UN',
            gtin: '',
            dataCriacao: '2026-01-01',
            dataAlteracao: '2026-02-01',
            precos: { preco: 199.9 },
            estoque: { saldo: 5 },
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncProducts } = await import('@/lib/olist/sync/products')
    const result = await syncProducts(ORG_ID)

    expect(result.received).toBe(1)
    expect(upsert.mock.calls[0][0][0]).toMatchObject({
      org_id: ORG_ID,
      olist_id: 100,
      sku: 'ANEL-01',
      descricao: 'Anel Prata',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/sync/products`
Expected: FAIL — module not found

- [ ] **Step 3: Implement products sync**

Create `lib/olist/sync/products.ts`:
```typescript
import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistProduct = {
  id: number
  sku: string | null
  descricao: string | null
  tipo: string | null
  situacao: string | null
  unidade: string | null
  gtin: string | null
  tipoVariacao?: string | null
  dataCriacao?: string | null
  dataAlteracao?: string | null
  precos?: unknown
  estoque?: unknown
}

export async function syncProducts(orgId: string): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  for await (const page of paginateOlist<OlistProduct>(orgId, '/produtos', {})) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((product) => ({
      org_id: orgId,
      olist_id: product.id,
      sku: product.sku,
      descricao: product.descricao,
      tipo: product.tipo,
      situacao: product.situacao,
      unidade: product.unidade,
      gtin: product.gtin,
      tipo_variacao: product.tipoVariacao ?? null,
      precos: product.precos ?? null,
      estoque: product.estoque ?? null,
      data_criacao_olist: product.dataCriacao ?? null,
      data_atualizacao_olist: product.dataAlteracao ?? null,
      raw: product,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_products').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_products: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/sync/products`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add lib/olist/sync/products.ts tests/unit/olist/sync/products.test.ts
git commit -m "feat: add Olist products sync"
```

---

### Task 11: Sync orders and order items

**Files:**
- Create: `lib/olist/sync/orders.ts`
- Test: `tests/unit/olist/sync/orders.test.ts`

**Interfaces:**
- Consumes: `paginateOlist`, `olistFetch` (Tasks 6-7), `createAdminSupabaseClient` (Task 2).
- Produces: `syncOrders(orgId: string, options?: { since?: Date }): Promise<{ received: number; created: number; updated: number }>` — consumed by the orchestrator (Task 14). Lists orders via `/pedidos` (paginated, `dataAtualizacao` filter when `since` given), then fetches `/pedidos/{id}` per order to get the embedded `itens`/`cliente`/`vendedor`/`pagamento`, and upserts both `olist_orders` and `olist_order_items`.

- [ ] **Step 1: Write failing test**

Create `tests/unit/olist/sync/orders.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/olist/client', () => ({ olistFetch: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { olistFetch } from '@/lib/olist/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncOrders', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fetches order detail for each listed order and upserts order + items', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[{ id: 500 }]]) as never)
    vi.mocked(olistFetch).mockResolvedValue({
      id: 500,
      numeroPedido: 1001,
      situacao: 1,
      origemPedido: 0,
      data: '2026-06-01',
      dataPrevista: '2026-06-05',
      valorTotalPedido: 250.5,
      valorTotalProdutos: 250.5,
      cliente: { id: 77 },
      vendedor: { id: 1 },
      itens: [
        {
          produto: { id: 100, sku: 'ANEL-01', descricao: 'Anel Prata' },
          quantidade: 1,
          valorUnitario: 250.5,
        },
      ],
    })

    const orderUpsert = vi.fn().mockResolvedValue({
      data: [{ id: 'internal-order-uuid' }],
      error: null,
    })
    const orderSelect = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'internal-order-uuid' }], error: null }) })
    const itemsDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const itemsInsert = vi.fn().mockResolvedValue({ error: null })

    const from = vi.fn((table: string) => {
      if (table === 'olist_orders') {
        return { upsert: vi.fn().mockReturnValue({ select: orderSelect().select }) }
      }
      if (table === 'olist_order_items') {
        return { delete: itemsDelete, insert: itemsInsert }
      }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncOrders } = await import('@/lib/olist/sync/orders')
    const result = await syncOrders(ORG_ID)

    expect(result.received).toBe(1)
    expect(olistFetch).toHaveBeenCalledWith(ORG_ID, '/pedidos/500')
    expect(itemsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        order_id: 'internal-order-uuid',
        produto_olist_id: 100,
        sku: 'ANEL-01',
        quantidade: 1,
        valor_unitario: 250.5,
      }),
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/sync/orders`
Expected: FAIL — module not found

- [ ] **Step 3: Implement orders sync**

Create `lib/olist/sync/orders.ts`:
```typescript
import { paginateOlist } from '@/lib/olist/paginate'
import { olistFetch } from '@/lib/olist/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistOrderListItem = { id: number }

type OlistOrderDetail = {
  id: number
  numeroPedido: number | null
  situacao: number | null
  origemPedido: number | null
  data: string | null
  dataPrevista: string | null
  dataEntrega: string | null
  dataFaturamento: string | null
  idNotaFiscal: number | null
  valorTotalProdutos: number | null
  valorTotalPedido: number | null
  valorDesconto: number | null
  valorFrete: number | null
  valorOutrasDespesas: number | null
  numeroOrdemCompra: string | null
  observacoes: string | null
  observacoesInternas: string | null
  cliente?: { id: number } | null
  vendedor?: { id: number } | null
  itens?: Array<{
    produto?: { id: number; sku?: string | null; descricao?: string | null } | null
    quantidade: number
    valorUnitario: number
    infoAdicional?: string | null
  }> | null
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function syncOrders(
  orgId: string,
  options: { since?: Date } = {}
): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const query = options.since ? { dataAtualizacao: toIsoDate(options.since) } : {}

  for await (const page of paginateOlist<OlistOrderListItem>(orgId, '/pedidos', query)) {
    for (const listItem of page) {
      received += 1

      const detail = await olistFetch<OlistOrderDetail>(orgId, `/pedidos/${listItem.id}`)

      const { data: upserted, error: orderError } = await admin
        .from('olist_orders')
        .upsert(
          {
            org_id: orgId,
            olist_id: detail.id,
            numero_pedido: detail.numeroPedido,
            situacao: detail.situacao,
            origem_pedido: detail.origemPedido,
            data: detail.data,
            data_prevista: detail.dataPrevista,
            data_entrega: detail.dataEntrega,
            data_faturamento: detail.dataFaturamento,
            id_nota_fiscal: detail.idNotaFiscal,
            valor_total_produtos: detail.valorTotalProdutos,
            valor_total_pedido: detail.valorTotalPedido,
            valor_desconto: detail.valorDesconto,
            valor_frete: detail.valorFrete,
            valor_outras_despesas: detail.valorOutrasDespesas,
            numero_ordem_compra: detail.numeroOrdemCompra,
            observacoes: detail.observacoes,
            observacoes_internas: detail.observacoesInternas,
            cliente_olist_id: detail.cliente?.id ?? null,
            vendedor_olist_id: detail.vendedor?.id ?? null,
            raw: detail,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,olist_id' }
        )
        .select('id')

      if (orderError || !upserted?.[0]) {
        throw new Error(`Failed to upsert olist_orders ${detail.id}: ${orderError?.message ?? 'no row returned'}`)
      }

      const orderId = upserted[0].id as string

      await admin.from('olist_order_items').delete().eq('order_id', orderId)

      const items = detail.itens ?? []
      if (items.length > 0) {
        const { error: itemsError } = await admin.from('olist_order_items').insert(
          items.map((item) => ({
            org_id: orgId,
            order_id: orderId,
            produto_olist_id: item.produto?.id ?? null,
            descricao_produto: item.produto?.descricao ?? null,
            sku: item.produto?.sku ?? null,
            quantidade: item.quantidade,
            valor_unitario: item.valorUnitario,
            info_adicional: item.infoAdicional ?? null,
            raw: item,
            synced_at: new Date().toISOString(),
          }))
        )

        if (itemsError) {
          throw new Error(`Failed to insert olist_order_items for order ${detail.id}: ${itemsError.message}`)
        }
      }
    }
  }

  return { received, created: received, updated: 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/sync/orders`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add lib/olist/sync/orders.ts tests/unit/olist/sync/orders.test.ts
git commit -m "feat: add Olist orders and order items sync"
```

---

### Task 12: Sync accounts payable (sliding-window incremental)

**Files:**
- Create: `lib/olist/sync/accounts-payable.ts`
- Test: `tests/unit/olist/sync/accounts-payable.test.ts`

**Interfaces:**
- Consumes: `paginateOlist` (Task 7), `createAdminSupabaseClient` (Task 2).
- Produces: `syncAccountsPayable(orgId: string, options?: { windowDays?: number }): Promise<{ received: number; created: number; updated: number }>` — consumed by the orchestrator (Task 14). `windowDays` defaults to 90; the function queries `/contas-pagar` with `dataInicialVencimento` = today minus `windowDays` and `dataFinalVencimento` unset (open-ended forward), covering both recent-past changes and all future-dated accounts in one pass.

**Known documentation inconsistency to verify empirically before writing this task's code:** the official OpenAPI spec's schema for `GET /contas-pagar` (`ListagemContasPagarResponseModel`) is documented as a single account-payable object, NOT wrapped in `{ itens: [...], paginacao: {...} }` like every sibling list endpoint (contatos, contas-receber, produtos, vendedores, formas-pagamento, pedidos all use that wrapper). This is almost certainly a spec-generation bug on Olist's side — but do not assume. Before implementing, make one real authenticated `GET https://api.tiny.com.br/public-api/v3/contas-pagar?limit=1` call (using the already-connected `test`/real org's token, e.g. via a throwaway script or curl with a manually-obtained access token) and confirm whether the response is wrapped in `itens`/`paginacao` or is a bare array/object. If it matches the other endpoints (the expected case), implement `paginateOlist` reuse exactly as the other sync tasks do. If it genuinely differs, do not force it through `paginateOlist` — write a small dedicated pagination loop for this one endpoint instead, and note the discrepancy in `docs/integrations/olist.md` (Task 16) as a documented, verified edge case, not a guess.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/olist/sync/accounts-payable.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncAccountsPayable', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps and upserts accounts payable', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 900,
            situacao: 'aberto',
            data: '2026-06-01',
            dataVencimento: '2026-07-01',
            historico: 'Aluguel Julho',
            valor: 1500,
            saldo: 1500,
            numeroDocumento: 'DOC-1',
            cliente: { id: 55 },
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncAccountsPayable } = await import('@/lib/olist/sync/accounts-payable')
    const result = await syncAccountsPayable(ORG_ID)

    expect(result.received).toBe(1)
    expect(upsert.mock.calls[0][0][0]).toMatchObject({
      org_id: ORG_ID,
      olist_id: 900,
      situacao: 'aberto',
      valor: 1500,
      fornecedor_olist_id: 55,
    })
  })

  it('queries with dataInicialVencimento set windowDays back from today', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncAccountsPayable } = await import('@/lib/olist/sync/accounts-payable')
    await syncAccountsPayable(ORG_ID, { windowDays: 60 })

    const call = vi.mocked(paginateOlist).mock.calls[0]
    expect(call[1]).toBe('/contas-pagar')
    expect(call[2]).toHaveProperty('dataInicialVencimento')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/sync/accounts-payable`
Expected: FAIL — module not found

- [ ] **Step 3: Implement accounts payable sync**

Create `lib/olist/sync/accounts-payable.ts`:
```typescript
import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistAccountPayable = {
  id: number
  situacao: string | null
  data: string | null
  dataVencimento: string | null
  historico: string | null
  valor: number | null
  saldo: number | null
  numeroDocumento: string | null
  serieDocumento: string | null
  cliente?: { id: number } | null
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function syncAccountsPayable(
  orgId: string,
  options: { windowDays?: number } = {}
): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const windowDays = options.windowDays ?? 90
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - windowDays)

  const query = { dataInicialVencimento: toIsoDate(windowStart) }

  for await (const page of paginateOlist<OlistAccountPayable>(orgId, '/contas-pagar', query)) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((account) => ({
      org_id: orgId,
      olist_id: account.id,
      situacao: account.situacao,
      data_emissao: account.data,
      data_vencimento: account.dataVencimento,
      historico: account.historico,
      valor: account.valor,
      saldo: account.saldo,
      numero_documento: account.numeroDocumento,
      serie_documento: account.serieDocumento,
      fornecedor_olist_id: account.cliente?.id ?? null,
      raw: account,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_accounts_payable').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_accounts_payable: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/sync/accounts-payable`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/olist/sync/accounts-payable.ts tests/unit/olist/sync/accounts-payable.test.ts
git commit -m "feat: add Olist accounts payable sync with sliding-window incremental"
```

---

### Task 13: Sync accounts receivable (sliding-window incremental)

**Files:**
- Create: `lib/olist/sync/accounts-receivable.ts`
- Test: `tests/unit/olist/sync/accounts-receivable.test.ts`

**Interfaces:**
- Consumes: `paginateOlist` (Task 7), `createAdminSupabaseClient` (Task 2).
- Produces: `syncAccountsReceivable(orgId: string, options?: { windowDays?: number }): Promise<{ received: number; created: number; updated: number }>` — consumed by the orchestrator (Task 14). Same sliding-window strategy as Task 12.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/olist/sync/accounts-receivable.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncAccountsReceivable', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps and upserts accounts receivable', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 700,
            situacao: 'pago',
            data: '2026-05-01',
            dataVencimento: '2026-06-01',
            historico: 'Venda #123',
            valor: 300,
            saldo: 0,
            numeroDocumento: 'NF-1',
            numeroBanco: '',
            quantidadeParcelasAntecipadas: 0,
            cliente: { id: 33 },
          },
        ],
      ]) as never
    )

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    const result = await syncAccountsReceivable(ORG_ID)

    expect(result.received).toBe(1)
    expect(upsert.mock.calls[0][0][0]).toMatchObject({
      org_id: ORG_ID,
      olist_id: 700,
      situacao: 'pago',
      cliente_olist_id: 33,
    })
  })

  it('defaults to a 90-day window when windowDays is not provided', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    await syncAccountsReceivable(ORG_ID)

    const call = vi.mocked(paginateOlist).mock.calls[0]
    const expectedStart = new Date()
    expectedStart.setDate(expectedStart.getDate() - 90)
    expect((call[2] as { dataInicialVencimento: string }).dataInicialVencimento).toBe(
      expectedStart.toISOString().slice(0, 10)
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/sync/accounts-receivable`
Expected: FAIL — module not found

- [ ] **Step 3: Implement accounts receivable sync**

Create `lib/olist/sync/accounts-receivable.ts`:
```typescript
import { paginateOlist } from '@/lib/olist/paginate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type OlistAccountReceivable = {
  id: number
  situacao: string | null
  data: string | null
  dataVencimento: string | null
  historico: string | null
  valor: number | null
  saldo: number | null
  numeroDocumento: string | null
  numeroBanco: string | null
  serieDocumento?: string | null
  quantidadeParcelasAntecipadas: number | null
  cliente?: { id: number } | null
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function syncAccountsReceivable(
  orgId: string,
  options: { windowDays?: number } = {}
): Promise<{ received: number; created: number; updated: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const windowDays = options.windowDays ?? 90
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - windowDays)

  const query = { dataInicialVencimento: toIsoDate(windowStart) }

  for await (const page of paginateOlist<OlistAccountReceivable>(orgId, '/contas-receber', query)) {
    if (page.length === 0) continue
    received += page.length

    const rows = page.map((account) => ({
      org_id: orgId,
      olist_id: account.id,
      situacao: account.situacao,
      data_emissao: account.data,
      data_vencimento: account.dataVencimento,
      historico: account.historico,
      valor: account.valor,
      saldo: account.saldo,
      numero_documento: account.numeroDocumento,
      numero_banco: account.numeroBanco,
      serie_documento: account.serieDocumento ?? null,
      cliente_olist_id: account.cliente?.id ?? null,
      quantidade_parcelas_antecipadas: account.quantidadeParcelasAntecipadas,
      raw: account,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('olist_accounts_receivable').upsert(rows, { onConflict: 'org_id,olist_id' })
    if (error) throw new Error(`Failed to upsert olist_accounts_receivable: ${error.message}`)
  }

  return { received, created: received, updated: 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/sync/accounts-receivable`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/olist/sync/accounts-receivable.ts tests/unit/olist/sync/accounts-receivable.test.ts
git commit -m "feat: add Olist accounts receivable sync with sliding-window incremental"
```

---

### Task 14: Sync orchestrator and manual-trigger route (RBAC-gated)

**Files:**
- Create: `lib/olist/sync/index.ts`, `app/api/integracoes/olist/sync/route.ts`
- Test: `tests/unit/olist/sync/index.test.ts`

**Interfaces:**
- Consumes: `syncSellers`, `syncPaymentMethods`, `syncContacts`, `syncProducts`, `syncOrders`, `syncAccountsPayable`, `syncAccountsReceivable` (Tasks 8-13), `startSyncRun`/`finishSyncRun` (Task 7), `getCurrentMember`/`canManageIntegrations` (Fase 0+1).
- Produces: `runOlistSync(orgId: string, mode: 'initial' | 'incremental'): Promise<void>` — one `sync_runs` row per entity, ordered so reference data (sellers, payment methods, contacts, products) syncs before orders/AP/AR that reference them by `olist_id`. Also `POST /api/integracoes/olist/sync`.

- [ ] **Step 1: Write failing test for the orchestrator**

Create `tests/unit/olist/sync/index.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/sync/sellers', () => ({ syncSellers: vi.fn().mockResolvedValue({ received: 1, created: 1, updated: 0 }) }))
vi.mock('@/lib/olist/sync/payment-methods', () => ({ syncPaymentMethods: vi.fn().mockResolvedValue({ received: 1, created: 1, updated: 0 }) }))
vi.mock('@/lib/olist/sync/contacts', () => ({ syncContacts: vi.fn().mockResolvedValue({ received: 2, created: 2, updated: 0 }) }))
vi.mock('@/lib/olist/sync/products', () => ({ syncProducts: vi.fn().mockResolvedValue({ received: 3, created: 3, updated: 0 }) }))
vi.mock('@/lib/olist/sync/orders', () => ({ syncOrders: vi.fn().mockResolvedValue({ received: 4, created: 4, updated: 0 }) }))
vi.mock('@/lib/olist/sync/accounts-payable', () => ({ syncAccountsPayable: vi.fn().mockResolvedValue({ received: 5, created: 5, updated: 0 }) }))
vi.mock('@/lib/olist/sync/accounts-receivable', () => ({ syncAccountsReceivable: vi.fn().mockResolvedValue({ received: 6, created: 6, updated: 0 }) }))
vi.mock('@/lib/olist/sync/run-context', () => ({
  startSyncRun: vi.fn().mockResolvedValue('run-1'),
  finishSyncRun: vi.fn().mockResolvedValue(undefined),
}))

import { syncContacts } from '@/lib/olist/sync/contacts'
import { syncOrders } from '@/lib/olist/sync/orders'
import { startSyncRun, finishSyncRun } from '@/lib/olist/sync/run-context'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('runOlistSync', () => {
  afterEach(() => vi.restoreAllMocks())

  it('runs reference data before orders/AP/AR, and logs one sync_runs entry', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'initial')

    expect(startSyncRun).toHaveBeenCalledWith(ORG_ID, 'olist')
    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'success' })
    )

    const contactsCallOrder = vi.mocked(syncContacts).mock.invocationCallOrder[0]
    const ordersCallOrder = vi.mocked(syncOrders).mock.invocationCallOrder[0]
    expect(contactsCallOrder).toBeLessThan(ordersCallOrder)
  })

  it('does not pass a since date on an initial sync', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'initial')

    expect(syncContacts).toHaveBeenCalledWith(ORG_ID, {})
  })

  it('passes a since date derived from the last successful run on an incremental sync', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'incremental')

    expect(syncContacts).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ since: expect.any(Date) }))
  })

  it('marks the run failed and rethrows when an entity sync throws', async () => {
    vi.mocked(syncOrders).mockRejectedValueOnce(new Error('boom'))

    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await expect(runOlistSync(ORG_ID, 'initial')).rejects.toThrow('boom')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('boom') })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/sync/index`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the orchestrator**

Create `lib/olist/sync/index.ts`:
```typescript
import { startSyncRun, finishSyncRun } from '@/lib/olist/sync/run-context'
import { syncSellers } from '@/lib/olist/sync/sellers'
import { syncPaymentMethods } from '@/lib/olist/sync/payment-methods'
import { syncContacts } from '@/lib/olist/sync/contacts'
import { syncProducts } from '@/lib/olist/sync/products'
import { syncOrders } from '@/lib/olist/sync/orders'
import { syncAccountsPayable } from '@/lib/olist/sync/accounts-payable'
import { syncAccountsReceivable } from '@/lib/olist/sync/accounts-receivable'

export async function runOlistSync(orgId: string, mode: 'initial' | 'incremental'): Promise<void> {
  const runId = await startSyncRun(orgId, 'olist')

  const since = mode === 'incremental' ? new Date(Date.now() - 24 * 60 * 60 * 1000) : undefined
  const sinceOptions = since ? { since } : {}

  let received = 0
  let created = 0
  let updated = 0

  try {
    // Reference data first — orders/AP/AR store references to these by olist_id.
    const sellers = await syncSellers(orgId)
    const paymentMethods = await syncPaymentMethods(orgId)
    const contacts = await syncContacts(orgId, sinceOptions)
    const products = await syncProducts(orgId)
    const orders = await syncOrders(orgId, sinceOptions)
    const accountsPayable = await syncAccountsPayable(orgId)
    const accountsReceivable = await syncAccountsReceivable(orgId)

    for (const result of [sellers, paymentMethods, contacts, products, orders, accountsPayable, accountsReceivable]) {
      received += result.received
      created += result.created
      updated += result.updated
    }

    await finishSyncRun(runId, {
      status: 'success',
      recordsReceived: received,
      recordsCreated: created,
      recordsUpdated: updated,
      errorCount: 0,
    })
  } catch (error) {
    await finishSyncRun(runId, {
      status: 'failed',
      recordsReceived: received,
      recordsCreated: created,
      recordsUpdated: updated,
      errorCount: 1,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/sync/index`
Expected: PASS (4 tests)

- [ ] **Step 5: Implement the manual-trigger route handler**

Create `app/api/integracoes/olist/sync/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { runOlistSync } from '@/lib/olist/sync'

export async function POST() {
  const member = await getCurrentMember()

  if (!member || !canManageIntegrations(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  try {
    await runOlistSync(member.orgId, 'incremental')
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/olist/sync/index.ts app/api/integracoes/olist/sync
git commit -m "feat: add Olist sync orchestrator and RBAC-gated manual trigger route"
```

---

### Task 15: Integrações page — real Olist status and manual sync button

**Files:**
- Create: `lib/olist/status.ts`, `components/integrations/olist-card.tsx`
- Modify: `app/(app)/integracoes/page.tsx`
- Test: `tests/unit/olist/status.test.ts`

**Interfaces:**
- Consumes: `createAdminSupabaseClient` (Task 2), `createServerSupabaseClient` (Fase 0+1), `formatDateBR` (Fase 0+1).
- Produces: `getOlistConnectionStatus(orgId: string): Promise<{ status: 'desconectado' | 'conectado' | 'precisa_reautorizar'; connectedAt: string | null }>` — server-only helper the Integrações page uses to pass just the status (never tokens) down to the client component.

- [ ] **Step 1: Write failing test for the status helper**

Create `tests/unit/olist/status.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('getOlistConnectionStatus', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns desconectado when there is no connection row', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { getOlistConnectionStatus } = await import('@/lib/olist/status')
    const result = await getOlistConnectionStatus(ORG_ID)

    expect(result).toEqual({ status: 'desconectado', connectedAt: null })
  })

  it('returns the stored status and connectedAt, never the tokens', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { status: 'conectado', connected_at: '2026-08-12T00:00:00Z' },
      error: null,
    })
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { getOlistConnectionStatus } = await import('@/lib/olist/status')
    const result = await getOlistConnectionStatus(ORG_ID)

    expect(result).toEqual({ status: 'conectado', connectedAt: '2026-08-12T00:00:00Z' })
    expect(select).toHaveBeenCalledWith('status, connected_at')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- olist/status`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the status helper**

Create `lib/olist/status.ts`:
```typescript
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export type OlistConnectionStatus = {
  status: 'desconectado' | 'conectado' | 'precisa_reautorizar'
  connectedAt: string | null
}

export async function getOlistConnectionStatus(orgId: string): Promise<OlistConnectionStatus> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('integration_connections')
    .select('status, connected_at')
    .eq('org_id', orgId)
    .eq('provider', 'olist')
    .single()

  if (!data) {
    return { status: 'desconectado', connectedAt: null }
  }

  return {
    status: data.status as OlistConnectionStatus['status'],
    connectedAt: (data.connected_at as string | null) ?? null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- olist/status`
Expected: PASS (2 tests)

- [ ] **Step 5: Implement the Olist card client component**

Create `components/integrations/olist-card.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateBR } from '@/lib/format/date'

type Props = {
  status: 'desconectado' | 'conectado' | 'precisa_reautorizar'
  connectedAt: string | null
}

const STATUS_LABEL: Record<Props['status'], string> = {
  desconectado: 'Desconectado',
  conectado: 'Conectado',
  precisa_reautorizar: 'Precisa reautorizar',
}

export function OlistCard({ status, connectedAt }: Props) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      const response = await fetch('/api/integracoes/olist/sync', { method: 'POST' })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        setSyncError(data.error ?? 'Falha ao sincronizar')
      } else {
        router.refresh()
      }
    } catch {
      setSyncError('Falha ao sincronizar')
    } finally {
      setSyncing(false)
    }
  }

  const needsConnect = status === 'desconectado' || status === 'precisa_reautorizar'

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="font-medium">Olist ERP</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Status: {STATUS_LABEL[status]}
        {connectedAt && status === 'conectado' && ` — conectado em ${formatDateBR(connectedAt)}`}
      </p>
      <div className="mt-3 flex gap-2">
        {needsConnect ? (
          <a
            href="/api/integracoes/olist/connect"
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            {status === 'precisa_reautorizar' ? 'Reconectar' : 'Conectar'}
          </a>
        ) : (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>
        )}
      </div>
      {syncError && <p className="mt-2 text-sm text-red-600">{syncError}</p>}
    </div>
  )
}
```

- [ ] **Step 6: Wire the card into the Integrações page**

Read `app/(app)/integracoes/page.tsx` first to see its current structure (built in Fase 0+1 Task 11 — it renders a placeholder card per integration by iterating `INTEGRATIONS`). Modify it to render `<OlistCard />` with real data specifically for the `olist` entry, keeping the SumUp card as the existing placeholder:

```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentMember } from '@/lib/auth/session'
import { getOlistConnectionStatus } from '@/lib/olist/status'
import { OlistCard } from '@/components/integrations/olist-card'
import { formatDateBR } from '@/lib/format/date'

export default async function IntegracoesPage() {
  const supabase = await createServerSupabaseClient()
  const member = await getCurrentMember()

  const olistStatus = member
    ? await getOlistConnectionStatus(member.orgId)
    : { status: 'desconectado' as const, connectedAt: null }

  const { data: lastSumupRun } = await supabase
    .from('sync_runs')
    .select('status, finished_at')
    .eq('integration', 'sumup')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Saúde das Integrações</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <OlistCard status={olistStatus.status} connectedAt={olistStatus.connectedAt} />
        <div className="rounded-lg border bg-white p-4">
          <h2 className="font-medium">SumUp</h2>
          {lastSumupRun ? (
            <p className="mt-1 text-sm text-neutral-600">
              Última sincronização: {formatDateBR(lastSumupRun.finished_at ?? new Date())} —{' '}
              {lastSumupRun.status}
            </p>
          ) : (
            <p className="mt-1 text-sm text-neutral-500">Nenhuma sincronização registrada ainda.</p>
          )}
        </div>
      </div>
    </div>
  )
}
```

Note: this removes the generic `INTEGRATIONS.map(...)` loop from Fase 0+1 in favor of one explicit block per provider, since Olist now needs bespoke UI (connect/sync buttons) that SumUp doesn't have yet. Keep the SumUp block's behavior identical to before (same query, same empty-state copy).

- [ ] **Step 7: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/olist/status.ts components/integrations/olist-card.tsx app/(app)/integracoes/page.tsx tests/unit/olist/status.test.ts
git commit -m "feat: show real Olist connection status and manual sync button on Integrações page"
```

---

### Task 16: Fill in `docs/integrations/olist.md` with real details

**Files:**
- Modify: `docs/integrations/olist.md`

**Interfaces:**
- Produces: none consumed by code — documentation required by the master plan's section 52.

- [ ] **Step 1: Replace the skeleton content**

Replace the entire content of `docs/integrations/olist.md` with:

```markdown
# Integração Olist ERP / Tiny

Status: implementada na Fase 2. API V3, OAuth2.

## Autenticação

- Base URL: `https://api.tiny.com.br/public-api/v3`
- Authorization: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth`
  (`client_id`, `redirect_uri`, `scope=openid`, `response_type=code`)
- Token: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`
  (`grant_type=authorization_code` na troca inicial, `grant_type=refresh_token`
  na renovação)
- Access token expira em 4 horas. Refresh token expira em 1 dia — se nenhum
  sync rodar dentro dessa janela, a conexão cai para `precisa_reautorizar` e
  exige reconexão manual via `/api/integracoes/olist/connect`.
- Credenciais: `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET`, `OLIST_REDIRECT_URI`,
  `OLIST_STATE_SECRET` em `.env.local`.
- Aplicativo criado no painel Olist/Tiny: Configurações → aba Geral →
  Aplicativos. Máximo 5 aplicativos por conta. Alterar permissões exige gerar
  um novo Client Secret.

## Endpoints utilizados

| Entidade | Endpoint | Paginação | Incremental |
|---|---|---|---|
| Contatos | `GET /contatos` | limit/offset | `dataAtualizacao` |
| Vendedores | `GET /vendedores` | limit/offset | não (tabela pequena, full sync sempre) |
| Formas de pagamento | `GET /formas-pagamento` | limit/offset | não (tabela pequena, full sync sempre) |
| Produtos | `GET /produtos` | limit/offset | não (full sync sempre nesta fase) |
| Pedidos | `GET /pedidos` (lista) + `GET /pedidos/{id}` (detalhe, traz itens/cliente/vendedor/pagamento) | limit/offset | `dataAtualizacao` |
| Contas a pagar | `GET /contas-pagar` | limit/offset | janela deslizante (sem filtro de data de atualização na API) |
| Contas a receber | `GET /contas-receber` | limit/offset | janela deslizante (sem filtro de data de atualização na API) |

## Estratégia incremental

- `pedidos` e `contatos`: usam o parâmetro `dataAtualizacao` da própria API.
- `contas-pagar`/`contas-receber`: a API não oferece filtro de data de
  atualização, só `dataInicialEmissao`/`dataFinalEmissao` e
  `dataInicialVencimento`/`dataFinalVencimento`. Estratégia adotada: toda
  sincronização (inicial ou incremental) busca a partir de
  `dataInicialVencimento = hoje - 90 dias`, sem data final — isso cobre
  contas futuras e recapture baixas/pagamentos recentes em contas já
  existentes sem precisar resync completo do histórico. O período de 90 dias
  é configurável via o parâmetro `windowDays` de `syncAccountsPayable`/
  `syncAccountsReceivable`.
- `produtos`, `vendedores`, `formas-pagamento`: full sync a cada execução
  (volumes pequenos, sem custo relevante).

## Edge cases e limitações conhecidas

- Nenhum rate limit documentado publicamente. O client (`lib/olist/client.ts`)
  faz retry com backoff exponencial (3 tentativas) em respostas 429/5xx.
- Refresh token válido por apenas 1 dia — sem agendamento automático (fora do
  escopo desta fase), a integração cai para `precisa_reautorizar` sempre que
  ninguém sincronizar manualmente por mais de ~1 dia. Isso é esperado, não é
  bug.
- `GET /pedidos/{id}` é chamado uma vez por pedido durante o sync (a listagem
  não traz itens) — para contas com muitos pedidos, isso significa N+1
  chamadas por sync. Aceitável para o volume da WEE; se o volume crescer,
  vale revisitar.
- Nenhuma escrita na Olist é feita nesta fase nem está planejada até segunda
  ordem — integração estritamente read-only.
```

- [ ] **Step 2: Commit**

```bash
git add docs/integrations/olist.md
git commit -m "docs: document the real Olist API V3 integration (was a skeleton)"
```

---

### Task 17: Codex review pass

**Files:** none created — review-only task.

- [ ] **Step 1: Run the full test suite one more time end to end**

Run: `npm run lint && npm run build && npm run test`
Expected: all pass. (No new e2e/RLS tests were added in this phase — the existing Fase 0+1 suites should still pass unchanged; run `npm run test:e2e` and `npm run test:rls` too if the local Supabase test user/fixtures are still set up, but a failure there unrelated to this phase's changes is not a regression to chase down in this task.)

- [ ] **Step 2: Request a Codex review of the diff**

Use the `codex:rescue` skill to get a second opinion on the full diff produced by Tasks 1–16, specifically checking: RLS policy correctness on the 8 new tables, that `integration_connections` truly has zero RLS policies and is never queried from client-side code, that `client_secret`/`access_token`/`refresh_token` never appear in any response sent to the browser (check the connect/callback routes and the status helper particularly), the OAuth2 state CSRF protection logic, and the token-refresh race/failure handling in `lib/olist/client.ts`.

- [ ] **Step 3: Address any findings**

Fix any issues Codex raises, re-run the full suite, and commit each fix separately with a message describing what was fixed.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: address Codex review findings for Fase 2 Olist integration"
```

(Skip this commit if Codex found nothing to change.)

---

## Definition of Done (matches the spec)

- [ ] Usuário consegue conectar via OAuth2 (fluxo real, verificado manualmente).
- [ ] Sync inicial e manual funcionam para todas as 7 entidades (contatos, vendedores, formas de pagamento, produtos, pedidos+itens, contas a pagar, contas a receber).
- [ ] `sync_runs` registra cada execução com contagens reais.
- [ ] Tela de Integrações mostra status real da conexão Olist e permite reconectar/sincronizar.
- [ ] `integration_connections` inacessível a `anon`/`authenticated` — só `service_role`.
- [ ] Nenhuma escrita na Olist.
- [ ] `docs/integrations/olist.md` preenchido com detalhes reais (endpoints, auth, paginação, estratégia incremental, edge cases).
- [ ] Codex review realizado e achados endereçados.
