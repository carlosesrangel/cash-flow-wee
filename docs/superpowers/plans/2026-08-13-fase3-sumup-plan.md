# WEE Cash Flow — Fase 3 (Integração SumUp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync SumUp transactions, transaction events, and payouts into Postgres using the already-configured static API key — no OAuth2, no connection flow. Read-only, same architectural pattern as Fase 2 (Olist).

**Architecture:** A static-Bearer-token HTTP client (`lib/sumup/client.ts`, modeled directly on the already-reviewed `lib/olist/client.ts`) with retry/backoff honoring `Retry-After`. A hypermedia-style pagination helper for `/transactions/history` (SumUp's `{items, links}` envelope, confirmed different from Olist's `{itens, paginacao}`). Two sync functions (transactions+events, payouts) reuse the existing generic `sync_runs` logging helpers and the RBAC-gated-route/orchestrator pattern from Fase 2 verbatim. Shared date utilities (`toOlistDateParam`, `emptyToNull`) are relocated from `lib/olist/date.ts` to a provider-agnostic `lib/integrations/date.ts`, per the Fase 2 final review's own recommendation, since this phase is the first real second consumer.

**Tech Stack:** Same as Fase 0-2 — Next.js 16 App Router, TypeScript strict, Supabase (Postgres/RLS via hand-written SQL migrations, no ORM), Zod, Vitest. No Playwright e2e for the sync logic itself (mirrors Fase 2's approach); covered by unit tests against fixtures plus a manual live-verification pass using the already-configured real SumUp key.

## Global Constraints

- Base API URL: `https://api.sumup.com`. Auth: static `Authorization: Bearer {SUMUP_API_KEY}` — no OAuth2, no token refresh, no per-org connection row. `SUMUP_API_KEY` and `SUMUP_MERCHANT_CODE` are already set in `.env.local`.
- `GET /v2.1/merchants/{merchant_code}/transactions/history`: paginated via a **hypermedia envelope** `{ items: T[], links: [{ rel: string, href: string }] }` — find the `rel: "next"` link and fetch its `href` directly for the next page; there is no `limit`/`offset` cursor to compute manually. List items do NOT include `transaction_events`.
- `GET /v2.1/merchants/{merchant_code}/transactions`: single-transaction detail, queried by `transaction_code` (or `id`/`foreign_transaction_id`/`client_transaction_id`) — **only this endpoint returns `transaction_events[]`**, requiring one detail fetch per transaction during sync (same N+1 pattern as Olist orders).
- `GET /v1.0/merchants/{merchant_code}/payouts`: requires `start_date`/`end_date` (`YYYY-MM-DD`, both required). Response is a **bare JSON array**, not wrapped in an envelope. No incremental/updated-since filter — use the same 90-day sliding-window strategy already used for Olist accounts payable/receivable.
- No writes to SumUp, ever. No fee-engine, no receipt-profile, no reconciliation logic in this phase (Fases 4 and 6).
- Never expose `SUMUP_API_KEY` to client-side code — server-only (`import 'server-only'` guard, matching the pattern already established for the Olist modules in Fase 2's final review).
- `org_id` + RLS on every new table, following the established pattern exactly (`is_org_member()`, no INSERT/UPDATE/DELETE policy for anon/authenticated — service_role only).
- No `integration_connections` row for SumUp — status is determined by a live connectivity check, not stored connection state.
- pt-BR UI copy, reuse `formatDateBR`/`formatBRL` from Fase 0+1 where displaying dates/currency.
- Commit after every task.

---

### Task 1: Database schema — `sumup_transactions`, `sumup_transaction_events`, `sumup_payouts`

**Files:**
- Create: `supabase/migrations/0009_sumup_integration.sql`

**Interfaces:**
- Produces: tables `sumup_transactions`, `sumup_transaction_events`, `sumup_payouts`. Every later task's SQL/TypeScript column references must match this migration exactly.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0009_sumup_integration.sql`:
```sql
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
```

- [ ] **Step 2: Apply and verify**

Run: `npx supabase db reset`
Expected: all migrations (0001-0009) apply cleanly. Verify the 3 new tables exist and each has exactly one SELECT policy via `pg_policies`, no INSERT/UPDATE/DELETE policies for anon/authenticated.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0009_sumup_integration.sql
git commit -m "feat: add sumup_transactions, sumup_transaction_events, sumup_payouts schema with RLS"
```

---

### Task 2: Relocate shared date utilities; add SumUp HTTP client and connectivity status check

**Files:**
- Create: `lib/integrations/date.ts` (relocated from `lib/olist/date.ts`), `lib/sumup/client.ts`, `lib/sumup/status.ts`
- Delete: `lib/olist/date.ts`
- Modify: `lib/olist/sync/accounts-payable.ts`, `lib/olist/sync/accounts-receivable.ts`, `lib/olist/sync/contacts.ts`, `lib/olist/sync/orders.ts`, `lib/olist/sync/products.ts` (update imports only)
- Test: `tests/unit/integrations/date.test.ts` (relocated from `tests/unit/olist/date.test.ts`), `tests/unit/sumup/client.test.ts`, `tests/unit/sumup/status.test.ts`
- Modify: `tests/unit/olist/sync/accounts-payable.test.ts`, `tests/unit/olist/sync/accounts-receivable.test.ts` (update mock import paths only)

**Interfaces:**
- Produces: `toLocalDateParam(date: Date): string` (renamed from `toOlistDateParam` — same implementation, provider-agnostic name/location), `emptyToNull(value: string | null | undefined): string | null` (unchanged), both from `@/lib/integrations/date`. `sumupFetch<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>`, `getSumupMerchantCode(): string` from `@/lib/sumup/client`. `checkSumupStatus(): Promise<'configurado' | 'erro_configuracao'>` from `@/lib/sumup/status`. Consumed by Tasks 4-7.

- [ ] **Step 1: Relocate the date utilities**

Read the current `lib/olist/date.ts` (contains `toOlistDateParam` and `emptyToNull`). Create `lib/integrations/date.ts` with the same two functions, renaming `toOlistDateParam` to `toLocalDateParam` and generalizing its JSDoc to not mention Olist specifically (say "for use as the value of an API date query param" rather than "Olist API date query params"). Keep `emptyToNull` and its JSDoc as-is (already provider-agnostic), just update the comment's first line to say "Some external APIs return..." instead of "The Olist API returns...". Delete `lib/olist/date.ts`.

- [ ] **Step 2: Update all Olist importers**

In each of `lib/olist/sync/accounts-payable.ts`, `lib/olist/sync/accounts-receivable.ts`, `lib/olist/sync/contacts.ts`, `lib/olist/sync/orders.ts`, `lib/olist/sync/products.ts`: change `import { toOlistDateParam, emptyToNull } from '@/lib/olist/date'` (or whichever subset each file imports) to `import { toLocalDateParam, emptyToNull } from '@/lib/integrations/date'`, and rename every call site from `toOlistDateParam(...)` to `toLocalDateParam(...)`.

- [ ] **Step 3: Relocate and update tests**

Move `tests/unit/olist/date.test.ts` to `tests/unit/integrations/date.test.ts`, updating its import path to `@/lib/integrations/date` and renaming `toOlistDateParam` references to `toLocalDateParam` throughout (test descriptions too, e.g. "toOlistDateParam" → "toLocalDateParam"). In `tests/unit/olist/sync/accounts-payable.test.ts` and `tests/unit/olist/sync/accounts-receivable.test.ts`, update any `vi.mock('@/lib/olist/date', ...)` calls to `vi.mock('@/lib/integrations/date', ...)`.

- [ ] **Step 4: Run the full suite to verify the relocation didn't break anything**

Run: `npm run test`
Expected: PASS, same test count as before this task (relocation should be net-zero on test count, not add/remove any).

- [ ] **Step 5: Write failing tests for the SumUp client**

Create `tests/unit/sumup/client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('sumupFetch', () => {
  beforeEach(() => {
    process.env.SUMUP_API_KEY = 'test-api-key'
    process.env.SUMUP_MERCHANT_CODE = 'MC-TEST'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('sends the API key as a Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const { sumupFetch } = await import('@/lib/sumup/client')
    await sumupFetch('/v2.1/merchants/MC-TEST/transactions/history')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.sumup.com/v2.1/merchants/MC-TEST/transactions/history')
    expect(init.headers.Authorization).toBe('Bearer test-api-key')
  })

  it('adds query params to the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const { sumupFetch } = await import('@/lib/sumup/client')
    await sumupFetch('/v2.1/merchants/MC-TEST/transactions/history', { limit: 100, changes_since: '2026-01-01' })

    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(url as string)
    expect(parsed.searchParams.get('limit')).toBe('100')
    expect(parsed.searchParams.get('changes_since')).toBe('2026-01-01')
  })

  it('retries on 429 honoring Retry-After, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name === 'Retry-After' ? '1' : null) },
        text: async () => 'rate limited',
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    const { sumupFetch } = await import('@/lib/sumup/client')
    const promise = sumupFetch('/v2.1/merchants/MC-TEST/transactions/history')
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('throws after exhausting retries on a persistent 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: async () => 'unavailable',
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    const { sumupFetch } = await import('@/lib/sumup/client')
    const promise = sumupFetch('/v2.1/merchants/MC-TEST/transactions/history')
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10000)
    await assertion
    vi.useRealTimers()
  })

  it('throws immediately on a non-retryable 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => null },
      text: async () => 'bad request',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { sumupFetch } = await import('@/lib/sumup/client')
    await expect(sumupFetch('/v2.1/merchants/MC-TEST/transactions/history')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('getSumupMerchantCode', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns the configured merchant code', async () => {
    process.env.SUMUP_MERCHANT_CODE = 'MC-TEST'
    const { getSumupMerchantCode } = await import('@/lib/sumup/client')
    expect(getSumupMerchantCode()).toBe('MC-TEST')
  })

  it('throws when SUMUP_MERCHANT_CODE is missing', async () => {
    delete process.env.SUMUP_MERCHANT_CODE
    const { getSumupMerchantCode } = await import('@/lib/sumup/client')
    expect(() => getSumupMerchantCode()).toThrow()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- sumup/client`
Expected: FAIL — `Cannot find module '@/lib/sumup/client'`

- [ ] **Step 7: Implement the SumUp client**

Create `lib/sumup/client.ts` (modeled directly on `lib/olist/client.ts`'s retry/backoff logic — read that file first for the exact pattern being mirrored):
```typescript
import 'server-only'

const API_BASE_URL = 'https://api.sumup.com'
const MAX_RETRIES = 3
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504])

function getApiKey(): string {
  const key = process.env.SUMUP_API_KEY
  if (!key) throw new Error('SUMUP_API_KEY must be set')
  return key
}

export function getSumupMerchantCode(): string {
  const code = process.env.SUMUP_MERCHANT_CODE
  if (!code) throw new Error('SUMUP_MERCHANT_CODE must be set')
  return code
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds * 1000
}

export async function sumupFetch<T>(
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${API_BASE_URL}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    })

    if (response.ok) {
      return (await response.json()) as T
    }

    const detail = await response.text()
    lastError = new Error(`SumUp API request failed (${response.status}) for ${path}: ${detail}`)

    if (!RETRY_STATUS_CODES.has(response.status) || attempt === MAX_RETRIES - 1) {
      throw lastError
    }

    const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers.get('Retry-After')) : null
    await sleep(retryAfterMs ?? 2 ** attempt * 500)
  }

  throw lastError ?? new Error(`SumUp API request failed for ${path}`)
}
```

Note the `path.startsWith('http')` branch: SumUp's pagination `links[].href` (Task 3) may be a fully-qualified URL or an absolute path — handle both without double-prefixing the base URL.

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -- sumup/client`
Expected: PASS (7 tests)

- [ ] **Step 9: Write failing tests for the status check**

Create `tests/unit/sumup/status.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/sumup/client', () => ({
  sumupFetch: vi.fn(),
  getSumupMerchantCode: vi.fn(() => 'MC-TEST'),
}))

import { sumupFetch } from '@/lib/sumup/client'

const ORIGINAL_ENV = { ...process.env }

describe('checkSumupStatus', () => {
  beforeEach(() => {
    process.env.SUMUP_API_KEY = 'test-key'
    process.env.SUMUP_MERCHANT_CODE = 'MC-TEST'
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns configurado when env vars are set and the test call succeeds', async () => {
    vi.mocked(sumupFetch).mockResolvedValue({ items: [], links: [] })

    const { checkSumupStatus } = await import('@/lib/sumup/status')
    expect(await checkSumupStatus()).toBe('configurado')
  })

  it('returns erro_configuracao when SUMUP_API_KEY is missing', async () => {
    delete process.env.SUMUP_API_KEY

    const { checkSumupStatus } = await import('@/lib/sumup/status')
    expect(await checkSumupStatus()).toBe('erro_configuracao')
    expect(sumupFetch).not.toHaveBeenCalled()
  })

  it('returns erro_configuracao when the test call fails', async () => {
    vi.mocked(sumupFetch).mockRejectedValue(new Error('401 unauthorized'))

    const { checkSumupStatus } = await import('@/lib/sumup/status')
    expect(await checkSumupStatus()).toBe('erro_configuracao')
  })
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npm run test -- sumup/status`
Expected: FAIL — `Cannot find module '@/lib/sumup/status'`

- [ ] **Step 11: Implement the status check**

Create `lib/sumup/status.ts`:
```typescript
import 'server-only'
import { sumupFetch, getSumupMerchantCode } from '@/lib/sumup/client'

export type SumupConnectionStatus = 'configurado' | 'erro_configuracao'

export async function checkSumupStatus(): Promise<SumupConnectionStatus> {
  if (!process.env.SUMUP_API_KEY || !process.env.SUMUP_MERCHANT_CODE) {
    return 'erro_configuracao'
  }

  try {
    await sumupFetch(`/v2.1/merchants/${getSumupMerchantCode()}/transactions/history`, { limit: 1 })
    return 'configurado'
  } catch {
    return 'erro_configuracao'
  }
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npm run test -- sumup/status`
Expected: PASS (3 tests)

- [ ] **Step 13: Run the full suite**

Run: `npm run test`
Expected: PASS, all tests including the relocated date tests and the new SumUp client/status tests.

- [ ] **Step 14: Commit**

```bash
git add lib/integrations lib/olist/sync lib/sumup lib/olist/date.ts tests/unit/integrations tests/unit/sumup tests/unit/olist
git commit -m "refactor: relocate date utilities to lib/integrations; add SumUp HTTP client and status check"
```

---

### Task 3: Hypermedia pagination helper for SumUp transaction history

**Files:**
- Create: `lib/sumup/paginate.ts`
- Test: `tests/unit/sumup/paginate.test.ts`

**Interfaces:**
- Consumes: `sumupFetch` (Task 2).
- Produces: `paginateSumupTransactions<T>(merchantCode: string, baseQuery: Record<string, string | number | undefined>, pageSize?: number): AsyncGenerator<T[]>` — consumed by Task 4.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/sumup/paginate.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/sumup/client', () => ({ sumupFetch: vi.fn() }))
import { sumupFetch } from '@/lib/sumup/client'

describe('paginateSumupTransactions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('follows the next link across pages until none remains', async () => {
    vi.mocked(sumupFetch)
      .mockResolvedValueOnce({
        items: [{ transaction_code: 'A' }, { transaction_code: 'B' }],
        links: [{ rel: 'next', href: '/v2.1/merchants/MC-TEST/transactions/history?limit=2&oldest_ref=B' }],
      })
      .mockResolvedValueOnce({
        items: [{ transaction_code: 'C' }],
        links: [],
      })

    const { paginateSumupTransactions } = await import('@/lib/sumup/paginate')
    const pages: unknown[] = []
    for await (const page of paginateSumupTransactions('MC-TEST', {}, 2)) {
      pages.push(page)
    }

    expect(pages).toEqual([
      [{ transaction_code: 'A' }, { transaction_code: 'B' }],
      [{ transaction_code: 'C' }],
    ])
    expect(sumupFetch).toHaveBeenCalledTimes(2)
    expect(sumupFetch).toHaveBeenNthCalledWith(
      1,
      '/v2.1/merchants/MC-TEST/transactions/history',
      { limit: 2 }
    )
    expect(sumupFetch).toHaveBeenNthCalledWith(
      2,
      '/v2.1/merchants/MC-TEST/transactions/history?limit=2&oldest_ref=B',
      undefined
    )
  })

  it('stops after the first page when there is no next link', async () => {
    vi.mocked(sumupFetch).mockResolvedValueOnce({ items: [{ transaction_code: 'A' }], links: [] })

    const { paginateSumupTransactions } = await import('@/lib/sumup/paginate')
    const pages: unknown[] = []
    for await (const page of paginateSumupTransactions('MC-TEST', {}, 100)) {
      pages.push(page)
    }

    expect(pages).toEqual([[{ transaction_code: 'A' }]])
    expect(sumupFetch).toHaveBeenCalledTimes(1)
  })

  it('stops when a page comes back empty even if a next link is somehow present', async () => {
    vi.mocked(sumupFetch).mockResolvedValueOnce({
      items: [],
      links: [{ rel: 'next', href: '/v2.1/merchants/MC-TEST/transactions/history?limit=100' }],
    })

    const { paginateSumupTransactions } = await import('@/lib/sumup/paginate')
    const pages: unknown[] = []
    for await (const page of paginateSumupTransactions('MC-TEST', {}, 100)) {
      pages.push(page)
    }

    expect(pages).toEqual([[]])
    expect(sumupFetch).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- sumup/paginate`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the pagination helper**

Create `lib/sumup/paginate.ts`:
```typescript
import { sumupFetch } from '@/lib/sumup/client'

type SumupLink = { rel: string; href: string }
type HypermediaResponse<T> = { items: T[]; links: SumupLink[] }

export async function* paginateSumupTransactions<T>(
  merchantCode: string,
  baseQuery: Record<string, string | number | undefined>,
  pageSize = 100
): AsyncGenerator<T[]> {
  let path: string | null = `/v2.1/merchants/${merchantCode}/transactions/history`
  let query: Record<string, string | number | undefined> | undefined = { ...baseQuery, limit: pageSize }

  while (path) {
    const page: HypermediaResponse<T> = await sumupFetch<HypermediaResponse<T>>(path, query)

    yield page.items

    if (page.items.length === 0) break

    const nextLink = page.links?.find((link) => link.rel === 'next')
    if (!nextLink) break

    path = nextLink.href
    query = undefined
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- sumup/paginate`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sumup/paginate.ts tests/unit/sumup/paginate.test.ts
git commit -m "feat: add hypermedia pagination helper for SumUp transaction history"
```

---

### Task 4: Sync SumUp transactions and transaction events

**Files:**
- Create: `lib/sumup/sync/transactions.ts`
- Test: `tests/unit/sumup/sync/transactions.test.ts`

**Interfaces:**
- Consumes: `paginateSumupTransactions` (Task 3), `sumupFetch`/`getSumupMerchantCode` (Task 2), `emptyToNull` (Task 2, from `@/lib/integrations/date`), `createAdminSupabaseClient` (Fase 2).
- Produces: `syncSumupTransactions(orgId: string, options?: { since?: Date }): Promise<{ received: number }>` — consumed by Task 6 (orchestrator).

- [ ] **Step 1: Write failing test**

Create `tests/unit/sumup/sync/transactions.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/sumup/paginate', () => ({ paginateSumupTransactions: vi.fn() }))
vi.mock('@/lib/sumup/client', () => ({
  sumupFetch: vi.fn(),
  getSumupMerchantCode: vi.fn(() => 'MC-TEST'),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateSumupTransactions } from '@/lib/sumup/paginate'
import { sumupFetch } from '@/lib/sumup/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

describe('syncSumupTransactions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fetches detail per transaction, upserts the transaction, replaces its events', async () => {
    vi.mocked(paginateSumupTransactions).mockReturnValue(
      fakePages([[{ transaction_code: 'TX1' }]]) as never
    )
    vi.mocked(sumupFetch).mockResolvedValue({
      transaction_code: 'TX1',
      transaction_id: 'uuid-abc',
      amount: 100.5,
      currency: 'BRL',
      timestamp: '2026-06-01T12:00:00Z',
      status: 'SUCCESSFUL',
      payment_type: 'ECOM',
      payout_date: '',
      transaction_events: [
        {
          id: 'ev1',
          event_type: 'PAYOUT',
          status: 'SUCCESSFUL',
          amount: 100.5,
          date: '2026-06-05',
          due_date: '',
          installment_number: 1,
        },
      ],
    })

    const txSelect = vi.fn().mockResolvedValue({ data: [{ id: 'internal-tx-uuid' }], error: null })
    const txUpsert = vi.fn().mockReturnValue({ select: txSelect })
    const eventsDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    const eventsInsert = vi.fn().mockResolvedValue({ error: null })

    const from = vi.fn((table: string) => {
      if (table === 'sumup_transactions') return { upsert: txUpsert }
      if (table === 'sumup_transaction_events') return { delete: eventsDelete, insert: eventsInsert }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncSumupTransactions } = await import('@/lib/sumup/sync/transactions')
    const result = await syncSumupTransactions(ORG_ID)

    expect(result).toEqual({ received: 1 })
    expect(sumupFetch).toHaveBeenCalledWith('/v2.1/merchants/MC-TEST/transactions', {
      transaction_code: 'TX1',
    })
    expect(txUpsert.mock.calls[0][0]).toMatchObject({
      org_id: ORG_ID,
      transaction_code: 'TX1',
      payout_date: null,
    })
    expect(eventsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        transaction_id: 'internal-tx-uuid',
        event_type: 'PAYOUT',
        due_date: null,
      }),
    ])
  })

  it('throws before inserting new events when deleting old ones fails', async () => {
    vi.mocked(paginateSumupTransactions).mockReturnValue(
      fakePages([[{ transaction_code: 'TX2' }]]) as never
    )
    vi.mocked(sumupFetch).mockResolvedValue({
      transaction_code: 'TX2',
      amount: 50,
      currency: 'BRL',
      timestamp: '2026-06-01T00:00:00Z',
      status: 'SUCCESSFUL',
      transaction_events: [],
    })

    const txSelect = vi.fn().mockResolvedValue({ data: [{ id: 'internal-tx-2' }], error: null })
    const txUpsert = vi.fn().mockReturnValue({ select: txSelect })
    const eventsDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: { message: 'delete boom' } }) })
    const eventsInsert = vi.fn()

    const from = vi.fn((table: string) => {
      if (table === 'sumup_transactions') return { upsert: txUpsert }
      if (table === 'sumup_transaction_events') return { delete: eventsDelete, insert: eventsInsert }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncSumupTransactions } = await import('@/lib/sumup/sync/transactions')
    await expect(syncSumupTransactions(ORG_ID)).rejects.toThrow(/delete boom/)
    expect(eventsInsert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- sumup/sync/transactions`
Expected: FAIL — module not found

- [ ] **Step 3: Implement transactions + events sync**

Create `lib/sumup/sync/transactions.ts`:
```typescript
import { paginateSumupTransactions } from '@/lib/sumup/paginate'
import { sumupFetch, getSumupMerchantCode } from '@/lib/sumup/client'
import { emptyToNull } from '@/lib/integrations/date'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type SumupTransactionListItem = { transaction_code: string }

type SumupTransactionEvent = {
  id?: string | null
  event_type: string
  status: string
  amount?: number | null
  date?: string | null
  due_date?: string | null
  timestamp?: string | null
  installment_number?: number | null
}

type SumupTransactionDetail = {
  transaction_code: string
  transaction_id?: string | null
  amount: number
  currency: string
  timestamp: string
  status: string
  simple_status?: string | null
  payment_type?: string | null
  card_type?: string | null
  entry_mode?: string | null
  installments_count?: number | null
  auth_code?: string | null
  vat_amount?: number | null
  tip_amount?: number | null
  fee_amount?: number | null
  payouts_total?: number | null
  payouts_received?: number | null
  payout_plan?: string | null
  payout_date?: string | null
  payout_type?: string | null
  refunded_amount?: number | null
  product_summary?: string | null
  user?: string | null
  transaction_events?: SumupTransactionEvent[] | null
}

export async function syncSumupTransactions(
  orgId: string,
  options: { since?: Date } = {}
): Promise<{ received: number }> {
  const admin = createAdminSupabaseClient()
  const merchantCode = getSumupMerchantCode()
  let received = 0

  const baseQuery = options.since ? { changes_since: options.since.toISOString() } : {}

  for await (const page of paginateSumupTransactions<SumupTransactionListItem>(merchantCode, baseQuery)) {
    for (const listItem of page) {
      received += 1

      const detail = await sumupFetch<SumupTransactionDetail>(
        `/v2.1/merchants/${merchantCode}/transactions`,
        { transaction_code: listItem.transaction_code }
      )

      const { data: upserted, error: txError } = await admin
        .from('sumup_transactions')
        .upsert(
          {
            org_id: orgId,
            transaction_code: detail.transaction_code,
            transaction_id: detail.transaction_id ?? null,
            amount: detail.amount,
            currency: detail.currency,
            timestamp_utc: detail.timestamp,
            status: detail.status,
            simple_status: detail.simple_status ?? null,
            payment_type: detail.payment_type ?? null,
            card_type: detail.card_type ?? null,
            entry_mode: detail.entry_mode ?? null,
            installments_count: detail.installments_count ?? null,
            auth_code: detail.auth_code ?? null,
            vat_amount: detail.vat_amount ?? null,
            tip_amount: detail.tip_amount ?? null,
            fee_amount: detail.fee_amount ?? null,
            payouts_total: detail.payouts_total ?? null,
            payouts_received: detail.payouts_received ?? null,
            payout_plan: detail.payout_plan ?? null,
            payout_date: emptyToNull(detail.payout_date),
            payout_type: detail.payout_type ?? null,
            refunded_amount: detail.refunded_amount ?? null,
            product_summary: detail.product_summary ?? null,
            username: detail.user ?? null,
            raw: detail,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,transaction_code' }
        )
        .select('id')

      if (txError || !upserted?.[0]) {
        throw new Error(
          `Failed to upsert sumup_transactions ${detail.transaction_code}: ${txError?.message ?? 'no row returned'}`
        )
      }

      const transactionId = upserted[0].id as string

      const { error: deleteError } = await admin
        .from('sumup_transaction_events')
        .delete()
        .eq('transaction_id', transactionId)

      if (deleteError) {
        throw new Error(
          `Failed to delete sumup_transaction_events for transaction ${detail.transaction_code}: ${deleteError.message}`
        )
      }

      const events = detail.transaction_events ?? []
      if (events.length > 0) {
        const { error: eventsError } = await admin.from('sumup_transaction_events').insert(
          events.map((event) => ({
            org_id: orgId,
            transaction_id: transactionId,
            sumup_event_id: event.id ?? null,
            event_type: event.event_type,
            status: event.status,
            amount: event.amount ?? null,
            event_date: emptyToNull(event.date),
            due_date: emptyToNull(event.due_date),
            event_timestamp: event.timestamp ?? null,
            installment_number: event.installment_number ?? null,
            raw: event,
            synced_at: new Date().toISOString(),
          }))
        )

        if (eventsError) {
          throw new Error(
            `Failed to insert sumup_transaction_events for transaction ${detail.transaction_code}: ${eventsError.message}`
          )
        }
      }
    }
  }

  return { received }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- sumup/sync/transactions`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sumup/sync/transactions.ts tests/unit/sumup/sync/transactions.test.ts
git commit -m "feat: add SumUp transactions and transaction events sync"
```

---

### Task 5: Sync SumUp payouts (sliding-window)

**Files:**
- Create: `lib/sumup/sync/payouts.ts`
- Test: `tests/unit/sumup/sync/payouts.test.ts`

**Interfaces:**
- Consumes: `sumupFetch`/`getSumupMerchantCode` (Task 2), `toLocalDateParam` (Task 2), `createAdminSupabaseClient`.
- Produces: `syncSumupPayouts(orgId: string, options?: { windowDays?: number }): Promise<{ received: number }>` — consumed by Task 6.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/sumup/sync/payouts.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/sumup/client', () => ({
  sumupFetch: vi.fn(),
  getSumupMerchantCode: vi.fn(() => 'MC-TEST'),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { sumupFetch } from '@/lib/sumup/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam } from '@/lib/integrations/date'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('syncSumupPayouts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps and upserts payouts from a bare array response', async () => {
    vi.mocked(sumupFetch).mockResolvedValue([
      {
        id: 123456789,
        type: 'PAYOUT',
        amount: 132.45,
        date: '2026-06-01',
        currency: 'BRL',
        fee: 3.12,
        status: 'SUCCESSFUL',
        reference: 'payout-ref',
        transaction_code: 'TX1',
      },
    ])

    const upsert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)

    const { syncSumupPayouts } = await import('@/lib/sumup/sync/payouts')
    const result = await syncSumupPayouts(ORG_ID)

    expect(result).toEqual({ received: 1 })
    expect(from).toHaveBeenCalledWith('sumup_payouts')
    expect(upsert.mock.calls[0][0][0]).toMatchObject({
      org_id: ORG_ID,
      sumup_payout_id: 123456789,
      type: 'PAYOUT',
      status: 'SUCCESSFUL',
    })
  })

  it('queries with a 90-day default window (start_date/end_date)', async () => {
    vi.mocked(sumupFetch).mockResolvedValue([])

    const { syncSumupPayouts } = await import('@/lib/sumup/sync/payouts')
    await syncSumupPayouts(ORG_ID)

    const windowStart = new Date()
    windowStart.setDate(windowStart.getDate() - 90)

    expect(sumupFetch).toHaveBeenCalledWith(
      '/v2.1/merchants/MC-TEST/payouts'.replace('v2.1', 'v1.0'),
      expect.objectContaining({
        start_date: toLocalDateParam(windowStart),
        end_date: toLocalDateParam(new Date()),
      })
    )
  })

  it('accepts an overridable windowDays option', async () => {
    vi.mocked(sumupFetch).mockResolvedValue([])

    const { syncSumupPayouts } = await import('@/lib/sumup/sync/payouts')
    await syncSumupPayouts(ORG_ID, { windowDays: 30 })

    const windowStart = new Date()
    windowStart.setDate(windowStart.getDate() - 30)

    expect(sumupFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ start_date: toLocalDateParam(windowStart) })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- sumup/sync/payouts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement payouts sync**

Create `lib/sumup/sync/payouts.ts`:
```typescript
import { sumupFetch, getSumupMerchantCode } from '@/lib/sumup/client'
import { toLocalDateParam } from '@/lib/integrations/date'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

type SumupPayout = {
  id: number
  type: string
  amount: number
  date: string
  currency: string
  fee?: number | null
  status: string
  reference?: string | null
  transaction_code?: string | null
}

export async function syncSumupPayouts(
  orgId: string,
  options: { windowDays?: number } = {}
): Promise<{ received: number }> {
  const admin = createAdminSupabaseClient()
  const merchantCode = getSumupMerchantCode()

  const windowDays = options.windowDays ?? 90
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - windowDays)

  const payouts = await sumupFetch<SumupPayout[]>(`/v1.0/merchants/${merchantCode}/payouts`, {
    start_date: toLocalDateParam(windowStart),
    end_date: toLocalDateParam(new Date()),
    limit: 1000,
  })

  if (payouts.length === 0) {
    return { received: 0 }
  }

  const rows = payouts.map((payout) => ({
    org_id: orgId,
    sumup_payout_id: payout.id,
    type: payout.type,
    amount: payout.amount,
    currency: payout.currency,
    payout_date: payout.date,
    fee: payout.fee ?? null,
    status: payout.status,
    reference: payout.reference ?? null,
    transaction_code: payout.transaction_code ?? null,
    raw: payout,
    synced_at: new Date().toISOString(),
  }))

  const { error } = await admin.from('sumup_payouts').upsert(rows, { onConflict: 'org_id,sumup_payout_id' })
  if (error) throw new Error(`Failed to upsert sumup_payouts: ${error.message}`)

  return { received: payouts.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- sumup/sync/payouts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/sumup/sync/payouts.ts tests/unit/sumup/sync/payouts.test.ts
git commit -m "feat: add SumUp payouts sync with sliding-window date range"
```

---

### Task 6: Sync orchestrator and RBAC-gated manual trigger route

**Files:**
- Create: `lib/sumup/sync/index.ts`, `app/api/integracoes/sumup/sync/route.ts`
- Test: `tests/unit/sumup/sync/index.test.ts`, `tests/unit/sumup/sync-route.test.ts`

**Interfaces:**
- Consumes: `syncSumupTransactions` (Task 4), `syncSumupPayouts` (Task 5), `startSyncRun`/`finishSyncRun` from `@/lib/olist/sync/run-context` (Fase 2, already generic — takes `integration: 'olist' | 'sumup'`, reused verbatim, no changes needed), `getCurrentMember`/`canManageIntegrations` (Fase 0+1).
- Produces: `runSumupSync(orgId: string, mode: 'initial' | 'incremental'): Promise<void>`, `POST /api/integracoes/sumup/sync`.

- [ ] **Step 1: Write failing test for the orchestrator**

Create `tests/unit/sumup/sync/index.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/sumup/sync/transactions', () => ({ syncSumupTransactions: vi.fn().mockResolvedValue({ received: 3 }) }))
vi.mock('@/lib/sumup/sync/payouts', () => ({ syncSumupPayouts: vi.fn().mockResolvedValue({ received: 2 }) }))
vi.mock('@/lib/olist/sync/run-context', () => ({
  startSyncRun: vi.fn().mockResolvedValue('run-1'),
  finishSyncRun: vi.fn().mockResolvedValue(undefined),
}))

import { syncSumupTransactions } from '@/lib/sumup/sync/transactions'
import { syncSumupPayouts } from '@/lib/sumup/sync/payouts'
import { startSyncRun, finishSyncRun } from '@/lib/olist/sync/run-context'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

describe('runSumupSync', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs a sync_runs entry for the sumup integration and sums received counts', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await runSumupSync(ORG_ID, 'initial')

    expect(startSyncRun).toHaveBeenCalledWith(ORG_ID, 'sumup')
    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'success', recordsReceived: 5, recordsCreated: null, recordsUpdated: null })
    )
  })

  it('does not pass a since date to transactions on initial mode', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await runSumupSync(ORG_ID, 'initial')

    expect(syncSumupTransactions).toHaveBeenCalledWith(ORG_ID, {})
  })

  it('passes a since date derived from 24h ago on incremental mode', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await runSumupSync(ORG_ID, 'incremental')

    expect(syncSumupTransactions).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ since: expect.any(Date) }))
  })

  it('uses a large windowDays for payouts on initial mode, default on incremental', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')

    await runSumupSync(ORG_ID, 'initial')
    expect(syncSumupPayouts).toHaveBeenLastCalledWith(ORG_ID, { windowDays: 3650 })

    await runSumupSync(ORG_ID, 'incremental')
    expect(syncSumupPayouts).toHaveBeenLastCalledWith(ORG_ID, {})
  })

  it('marks the run failed and rethrows when a sync function throws', async () => {
    vi.mocked(syncSumupPayouts).mockRejectedValueOnce(new Error('boom'))

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('boom')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('boom') })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- sumup/sync/index`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the orchestrator**

Create `lib/sumup/sync/index.ts`:
```typescript
import { startSyncRun, finishSyncRun } from '@/lib/olist/sync/run-context'
import { syncSumupTransactions } from '@/lib/sumup/sync/transactions'
import { syncSumupPayouts } from '@/lib/sumup/sync/payouts'

export async function runSumupSync(orgId: string, mode: 'initial' | 'incremental'): Promise<void> {
  const runId = await startSyncRun(orgId, 'sumup')

  const since = mode === 'incremental' ? new Date(Date.now() - 24 * 60 * 60 * 1000) : undefined
  const transactionsOptions = since ? { since } : {}
  const payoutsOptions = mode === 'initial' ? { windowDays: 3650 } : {}

  let received = 0

  try {
    const transactions = await syncSumupTransactions(orgId, transactionsOptions)
    const payouts = await syncSumupPayouts(orgId, payoutsOptions)

    received = transactions.received + payouts.received

    await finishSyncRun(runId, {
      status: 'success',
      recordsReceived: received,
      recordsCreated: null,
      recordsUpdated: null,
      errorCount: 0,
    })
  } catch (error) {
    await finishSyncRun(runId, {
      status: 'failed',
      recordsReceived: received,
      recordsCreated: null,
      recordsUpdated: null,
      errorCount: 1,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- sumup/sync/index`
Expected: PASS (5 tests)

- [ ] **Step 5: Write failing test for the route handler**

Create `tests/unit/sumup/sync-route.test.ts` (mirrors `tests/unit/olist/sync-route.test.ts` exactly — read that file first for the pattern):
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageIntegrations: vi.fn() }))
vi.mock('@/lib/sumup/sync/index', () => ({ runSumupSync: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { runSumupSync } from '@/lib/sumup/sync/index'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'OWNER_ADMIN' as const }

function mockSyncRunsQuery(result: { data: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const limit = vi.fn().mockReturnValue({ maybeSingle })
  const gte = vi.fn().mockReturnValue({ limit, maybeSingle })
  const eq2 = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ limit, maybeSingle, gte }) })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { from: vi.fn().mockReturnValue({ select }) }
}

describe('POST /api/integracoes/sumup/sync', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()

    expect(response.status).toBe(403)
    expect(runSumupSync).not.toHaveBeenCalled()
  })

  it('returns 403 when the member lacks canManageIntegrations', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canManageIntegrations).mockReturnValue(false)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()

    expect(response.status).toBe(403)
    expect(runSumupSync).not.toHaveBeenCalled()
  })

  it('returns 409 when a sync is already running', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageIntegrations).mockReturnValue(true)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSyncRunsQuery({ data: { id: 'active-run' } }) as never)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()

    expect(response.status).toBe(409)
    expect(runSumupSync).not.toHaveBeenCalled()
  })

  it('calls runSumupSync in initial mode when no prior successful run exists, returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageIntegrations).mockReturnValue(true)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockSyncRunsQuery({ data: null }) as never)
    vi.mocked(runSumupSync).mockResolvedValue(undefined)

    const { POST } = await import('@/app/api/integracoes/sumup/sync/route')
    const response = await POST()
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(runSumupSync).toHaveBeenCalledWith(ORG_ID, 'initial')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- sumup/sync-route`
Expected: FAIL — module not found

- [ ] **Step 7: Implement the route handler**

Read `app/api/integracoes/olist/sync/route.ts` first — this is a near-verbatim adaptation of it. Create `app/api/integracoes/sumup/sync/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { runSumupSync } from '@/lib/sumup/sync'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ACTIVE_SYNC_STALENESS_MS = 10 * 60 * 1000

async function hasPriorSuccessfulSync(orgId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('sync_runs')
    .select('id')
    .eq('org_id', orgId)
    .eq('integration', 'sumup')
    .eq('status', 'success')
    .limit(1)
    .maybeSingle()

  return Boolean(data)
}

async function hasActiveSyncRun(orgId: string): Promise<boolean> {
  const admin = createAdminSupabaseClient()
  const cutoff = new Date(Date.now() - ACTIVE_SYNC_STALENESS_MS).toISOString()
  const { data } = await admin
    .from('sync_runs')
    .select('id')
    .eq('org_id', orgId)
    .eq('integration', 'sumup')
    .eq('status', 'running')
    .gte('started_at', cutoff)
    .limit(1)
    .maybeSingle()

  return Boolean(data)
}

export async function POST() {
  const member = await getCurrentMember()

  if (!member || !canManageIntegrations(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  if (await hasActiveSyncRun(member.orgId)) {
    return NextResponse.json({ error: 'Sincronização já em andamento' }, { status: 409 })
  }

  try {
    const mode = (await hasPriorSuccessfulSync(member.orgId)) ? 'incremental' : 'initial'
    await runSumupSync(member.orgId, mode)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -- sumup/sync-route`
Expected: PASS (4 tests)

- [ ] **Step 9: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 10: Commit**

```bash
git add lib/sumup/sync/index.ts app/api/integracoes/sumup tests/unit/sumup/sync/index.test.ts tests/unit/sumup/sync-route.test.ts
git commit -m "feat: add SumUp sync orchestrator and RBAC-gated manual trigger route"
```

---

### Task 7: Integrações page — real SumUp status and manual sync button

**Files:**
- Create: `components/integrations/sumup-card.tsx`
- Modify: `app/(app)/integracoes/page.tsx`
- Test: `tests/unit/components/sumup-card.test.tsx`

**Interfaces:**
- Consumes: `checkSumupStatus` (Task 2), `canManageIntegrations` (Fase 0+1).
- Produces: replaces the SumUp placeholder block in the Integrações page with a real card.

- [ ] **Step 1: Read the current page and the Olist card for the pattern**

Read `app/(app)/integracoes/page.tsx` (current SumUp block is the inline placeholder `<div>` after `<OlistCard>`) and `components/integrations/olist-card.tsx` (structure/styling to mirror, minus the Connect/Reconnect concept — SumUp has no connection state, only "configurado"/"erro_configuracao").

- [ ] **Step 2: Implement the SumUp card component**

Create `components/integrations/sumup-card.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  status: 'configurado' | 'erro_configuracao'
  canManage: boolean
}

const STATUS_LABEL: Record<Props['status'], string> = {
  configurado: 'Configurado',
  erro_configuracao: 'Erro de configuração',
}

export function SumupCard({ status, canManage }: Props) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      const response = await fetch('/api/integracoes/sumup/sync', { method: 'POST' })
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

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="font-medium">SumUp</h2>
      <p className="mt-1 text-sm text-neutral-600">Status: {STATUS_LABEL[status]}</p>
      {canManage ? (
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSync}
            disabled={syncing || status === 'erro_configuracao'}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-neutral-500">
          Apenas administradores podem gerenciar esta integração.
        </p>
      )}
      {syncError && <p className="mt-2 text-sm text-red-600">{syncError}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Write the component test**

Create `tests/unit/components/sumup-card.test.tsx` (mirror `tests/unit/components/olist-card.test.tsx`'s structure and mocking approach — read it first):
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { SumupCard } from '@/components/integrations/sumup-card'

describe('SumupCard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the sync button when canManage is true and status is configurado', () => {
    render(<SumupCard status="configurado" canManage={true} />)
    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).toBeInTheDocument()
  })

  it('disables the sync button when status is erro_configuracao', () => {
    render(<SumupCard status="erro_configuracao" canManage={true} />)
    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).toBeDisabled()
  })

  it('hides the sync button entirely when canManage is false', () => {
    render(<SumupCard status="configurado" canManage={false} />)
    expect(screen.queryByRole('button', { name: 'Sincronizar agora' })).not.toBeInTheDocument()
    expect(screen.getByText(/Apenas administradores/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Wire the card into the Integrações page**

Modify `app/(app)/integracoes/page.tsx`: replace the inline SumUp placeholder `<div>` block with `<SumupCard>`, and replace the `lastSumupRun` query (which only showed last-sync text) with a `checkSumupStatus()` call. Full replacement:
```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { getOlistConnectionStatus } from '@/lib/olist/status'
import { checkSumupStatus } from '@/lib/sumup/status'
import { OlistCard } from '@/components/integrations/olist-card'
import { SumupCard } from '@/components/integrations/sumup-card'

export default async function IntegracoesPage() {
  const member = await getCurrentMember()

  const olistStatus = member
    ? await getOlistConnectionStatus(member.orgId)
    : { status: 'desconectado' as const, connectedAt: null }

  const sumupStatus = await checkSumupStatus()
  const canManage = Boolean(member && canManageIntegrations(member.role))

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Saúde das Integrações</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <OlistCard
          status={olistStatus.status}
          connectedAt={olistStatus.connectedAt}
          canManage={canManage}
        />
        <SumupCard status={sumupStatus} canManage={canManage} />
      </div>
    </div>
  )
}
```

Note: `createServerSupabaseClient` and the `sync_runs` query for SumUp's last-run text are removed entirely — `checkSumupStatus()` replaces that display with a live configuration check instead, per this phase's design (no "last sync" text on this card since the connectivity state, not history, is the primary signal here — the `sync_runs` history itself is still recorded by Task 6's orchestrator and available for a future "últimas execuções" list if that's added later).

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 6: Run the full suite**

Run: `npm run test`
Expected: PASS, all tests including the new SumUp card test.

- [ ] **Step 7: Manual verification (optional, documented if attempted)**

With `npm run dev` running and logged in as `test@wee.com.br`, visit `/integracoes` and confirm the SumUp card shows "Configurado" (the real key is already set) and that "Sincronizar agora" works, populating `sumup_transactions`/`sumup_transaction_events`/`sumup_payouts` — check via Supabase Studio.

- [ ] **Step 8: Commit**

```bash
git add components/integrations/sumup-card.tsx app/\(app\)/integracoes/page.tsx tests/unit/components/sumup-card.test.tsx
git commit -m "feat: show real SumUp status and manual sync button on Integrações page"
```

---

### Task 8: `docs/integrations/sumup.md` real content

**Files:**
- Modify: `docs/integrations/sumup.md`

**Interfaces:**
- Produces: none consumed by code — documentation required by the master plan's section 52.

- [ ] **Step 1: Replace the skeleton content**

Replace the entire content of `docs/integrations/sumup.md` with:

```markdown
# Integração SumUp

Status: implementada na Fase 3. Autenticação por API key estática (sem OAuth2).

## Autenticação

- Base URL: `https://api.sumup.com`
- `Authorization: Bearer {SUMUP_API_KEY}` — chave estática obtida em
  me.sumup.com → Configurações → For Developers → Toolkit → API Keys.
  Concede acesso total à conta do merchant que a criou; a SumUp não guarda
  cópia, então a chave precisa ser preservada com segurança (já está em
  `.env.local`, nunca commitada).
- `SUMUP_MERCHANT_CODE` identifica a conta nos paths dos endpoints.
- Sem fluxo de conexão interativo, sem refresh de token — diferente da
  Olist. O status "Configurado"/"Erro de configuração" na tela de
  Integrações vem de uma chamada de teste sob demanda, não de estado
  persistido.

## Endpoints utilizados

| Recurso | Endpoint | Paginação |
|---|---|---|
| Histórico de transações | `GET /v2.1/merchants/{merchant_code}/transactions/history` | Hypermedia (`{items, links}`, segue `links[rel=next].href`) |
| Detalhe de transação (+ eventos) | `GET /v2.1/merchants/{merchant_code}/transactions?transaction_code=...` | N/A (registro único) |
| Payouts | `GET /v1.0/merchants/{merchant_code}/payouts` | Array simples, exige `start_date`/`end_date` |

## Estratégia incremental

- Transações: `changes_since` na própria API.
- Payouts: sem filtro de data de atualização — janela deslizante de 90 dias
  (`start_date = hoje - 90 dias`, `end_date = hoje`) em toda sincronização,
  igual à estratégia da Olist para contas a pagar/receber. Sincronização
  `initial` usa uma janela de ~10 anos para capturar todo o histórico na
  primeira conexão (mesma correção aplicada à Olist na revisão final da
  Fase 2).

## Edge cases e limitações conhecidas

- `transaction_events[]` só existe no endpoint de detalhe — o histórico não
  traz eventos. Isso significa uma chamada de detalhe por transação durante
  o sync (mesmo padrão N+1 da sincronização de pedidos da Olist), com o
  mesmo risco de rate limiting em volumes grandes.
- Nenhum limite de taxa documentado publicamente — o cliente
  (`lib/sumup/client.ts`) reaproveita a lógica de retry/backoff com
  `Retry-After` já validada na Olist.
- Nenhuma escrita na SumUp nesta fase nem planejada até segunda ordem —
  integração estritamente read-only.
- Sem motor de taxas históricas, perfil de recebimento ou reconciliação com
  a Olist nesta fase — ver Fases 4 e 6 do documento mestre.
```

- [ ] **Step 2: Commit**

```bash
git add docs/integrations/sumup.md
git commit -m "docs: document the real SumUp integration (was a skeleton)"
```

---

### Task 9: Codex review pass

**Files:** none created — review-only task.

- [ ] **Step 1: Run the full test suite one more time end to end**

Run: `npm run lint && npm run build && npm run test`
Expected: all pass. Also run `npm run test:rls` and `npm run test:e2e` for regression confidence against the unrelated Fase 0-2 suites.

- [ ] **Step 2: Request a Codex review of the diff**

Use the `codex:rescue` skill to get a second opinion on the full diff produced by Tasks 1-8, specifically checking: RLS correctness on the 3 new tables, that `SUMUP_API_KEY` never reaches client-side code or a JSON response, the retry/backoff logic, the transaction+events delete-then-insert pattern (same class of concern already fixed for Olist orders), and whether the relocated `lib/integrations/date.ts` broke anything for the existing Olist consumers.

- [ ] **Step 3: Manually verify against the real, already-configured SumUp account**

With `npm run dev` running, log in and trigger a real sync via the Integrações page. Document what's actually synced (row counts) and any real-API surprises the same way Fase 2's live testing did — SumUp's documentation may have the same class of inconsistencies (date formats, empty-vs-null fields, unexpected pagination edge cases) that Olist's did. Fix anything found, following the same "verify empirically, don't guess" discipline used throughout Fase 2.

- [ ] **Step 4: Address any findings**

Fix any issues Codex or the manual verification raise, re-run the full suite, and commit each fix separately with a message describing what was fixed.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: address Codex review and live-verification findings for Fase 3 SumUp integration"
```

(Skip this commit if nothing needed changing.)

---

## Definition of Done (matches the spec)

- [ ] Sincronização de transações, eventos de transação e payouts funciona contra a API real da SumUp (verificado manualmente).
- [ ] `sync_runs` registra cada execução (integration='sumup').
- [ ] Tela de Integrações mostra status real de configuração da SumUp e permite sincronizar.
- [ ] `SUMUP_API_KEY` nunca alcança código client-side (guard `server-only`).
- [ ] Nenhuma escrita na SumUp.
- [ ] `docs/integrations/sumup.md` preenchido com detalhes reais.
- [ ] `lib/integrations/date.ts` reutilizado corretamente por Olist e SumUp, sem duplicação.
- [ ] Codex review realizado e achados endereçados.
