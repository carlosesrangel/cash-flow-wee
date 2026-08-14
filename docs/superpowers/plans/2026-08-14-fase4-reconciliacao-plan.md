# WEE Cash Flow — Fase 4: Reconciliação Financeira — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reconciliation layer that links each card-paid Olist accounts-receivable installment to its matching SumUp settlement, so the future cash-flow engine never double-counts Olist orders/AR against SumUp transactions.

**Architecture:** Extend the Olist AR sync to fetch per-installment detail (fee, payment method, settlement date) via the same N+1 pattern already used for orders; add a `lib/reconciliation/` module with pure matching helpers plus a DB-driven runner that upserts into a new `reconciliation_matches` table; run that engine automatically at the end of every successful Olist/SumUp sync; expose a read/confirm/undo UI gated by RBAC.

**Tech Stack:** Next.js 16 (App Router, Route Handlers with `RouteContext<...>` typed params), Supabase (Postgres + PostgREST via `@supabase/supabase-js`, RLS), TypeScript, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md`

## Global Constraints

- Never sum Olist Orders + Olist AR + SumUp Transactions directly — this phase only *produces* `reconciliation_matches`; it must not touch any balance/projection calculation (out of scope, Fase 5).
- Matching compares **gross vs. gross**: Olist AR's own `valor` (already gross) against `sumup_transactions.amount / installments_count` (SumUp's gross-per-installment estimate). SumUp's real net value/fee/settlement date are only used to *enrich* after a match is confirmed, never to decide the match.
- Candidates are restricted to AR rows whose `forma_recebimento_nome` is `'Cartão de crédito'` or `'Cartão de débito'` — every other payment method never reaches SumUp and is excluded from matching entirely.
- Amount tolerance: ≤ R$ 0,05. Date tolerance: ±5 days between AR `data_vencimento` and the SumUp event's `due_date`.
- 0 candidates → `nao_reconciliado`; exactly 1 → `reconciliado_automaticamente`; >1 → `conflito` (never auto-pick one).
- Conflict resolution and undo are RBAC-gated to `OWNER_ADMIN`/`MANAGER`; `VIEWER` is read-only. All new DB writes go through `service_role` (the admin client) — no INSERT/UPDATE/DELETE policy is granted to `anon`/`authenticated` on any new or extended table, matching the existing "server writes only" pattern.
- The reconciliation engine runs automatically at the end of every successful `runOlistSync`/`runSumupSync` — no separate manual trigger.
- No automated test may call the real Olist or SumUp API — same as Fases 2/3.
- `reconciliation_matches` has a unique `(org_id, olist_accounts_receivable_id)` constraint — the engine upserts, never inserts duplicates, and running it twice must not lose an already-resolved (auto or manual) row's status.

---

### Task 1: Migration — extend `olist_accounts_receivable`, create `reconciliation_matches`

**Files:**
- Create: `supabase/migrations/0011_reconciliation.sql`

**Interfaces:**
- Produces: columns `olist_accounts_receivable.taxa numeric`, `.valor_pago numeric`, `.forma_recebimento_id bigint`, `.forma_recebimento_nome text`, `.data_liquidacao date`; table `reconciliation_matches` with columns `id uuid`, `org_id uuid`, `olist_accounts_receivable_id uuid`, `sumup_transaction_id uuid`, `sumup_transaction_event_id uuid`, `status text`, `match_reason jsonb`, `candidate_ids jsonb`, `resolved_by uuid`, `resolved_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`.

- [ ] **Step 1: Write the migration**

```sql
-- Fase 4: reconciliation layer (Olist AR installments x SumUp settlements).

-- The Olist AR detail endpoint (GET /contas-receber/{id}, not used by the
-- listing-only sync from Fase 2) exposes per-installment fee, payment
-- method, and settlement fields that the listing endpoint never returns.
-- See docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md,
-- finding 4.
alter table olist_accounts_receivable
  add column taxa numeric,
  add column valor_pago numeric,
  add column forma_recebimento_id bigint,
  add column forma_recebimento_nome text,
  add column data_liquidacao date;

create index olist_accounts_receivable_forma_recebimento_nome_idx
  on olist_accounts_receivable(forma_recebimento_nome);

create table reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  olist_accounts_receivable_id uuid not null references olist_accounts_receivable(id) on delete cascade,
  sumup_transaction_id uuid references sumup_transactions(id) on delete set null,
  sumup_transaction_event_id uuid references sumup_transaction_events(id) on delete set null,
  status text not null check (
    status in ('reconciliado_automaticamente', 'reconciliado_manualmente', 'nao_reconciliado', 'conflito')
  ),
  match_reason jsonb not null default '{}'::jsonb,
  candidate_ids jsonb not null default '[]'::jsonb,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, olist_accounts_receivable_id)
);

create index reconciliation_matches_org_id_idx on reconciliation_matches(org_id);
create index reconciliation_matches_status_idx on reconciliation_matches(status);

alter table reconciliation_matches enable row level security;

create policy "members can read reconciliation_matches in their org" on reconciliation_matches
  for select using (is_org_member(org_id));
```

- [ ] **Step 2: Apply the migration locally and confirm it runs cleanly**

Run: `npx supabase migration up` (or the project's usual local-migration command — check `docs/architecture.md` if unsure of the exact invocation used so far in this repo)
Expected: migration `0011_reconciliation.sql` applies with no errors; `reconciliation_matches` and the five new `olist_accounts_receivable` columns exist in the local database (verify via Supabase Studio or `\d reconciliation_matches` in `psql`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_reconciliation.sql
git commit -m "feat: add reconciliation_matches table and extend olist_accounts_receivable with per-installment detail"
```

---

### Task 2: Extend the Olist AR sync to fetch per-installment detail

**Files:**
- Modify: `lib/olist/sync/accounts-receivable.ts`
- Test: `tests/unit/olist/sync/accounts-receivable.test.ts`

**Interfaces:**
- Consumes: `olistFetch<T>(orgId: string, path: string, query?): Promise<T>` from `@/lib/olist/client` (existing, used by `syncOrders`).
- Produces: `syncAccountsReceivable(orgId: string, options?: { windowDays?: number }): Promise<{ received: number }>` — same signature as before; now upserts the five new columns per row using the detail endpoint's `taxa`, `formaRecebimento.{id,nome}`, `dataLiquidacao`, `valorPago`.

- [ ] **Step 1: Write the failing tests**

Replace the whole file with:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/olist/paginate', () => ({ paginateOlist: vi.fn() }))
vi.mock('@/lib/olist/client', () => ({ olistFetch: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { paginateOlist } from '@/lib/olist/paginate'
import { olistFetch } from '@/lib/olist/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam } from '@/lib/integrations/date'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

async function* fakePages(pages: unknown[][]) {
  for (const page of pages) yield page
}

function mockAdmin() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn().mockReturnValue({ upsert })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { upsert }
}

describe('syncAccountsReceivable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('fetches per-installment detail and upserts it alongside the listing fields', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 50,
            situacao: 'aberta',
            data: '2026-01-01',
            dataVencimento: '2026-02-01',
            historico: 'Ref. a NF nº 516, Giovana Dias (parcela 3/3)',
            valor: 380,
            saldo: 380,
            numeroDocumento: '000516/03',
            numeroBanco: 'B1',
            serieDocumento: 'S1',
            quantidadeParcelasAntecipadas: 0,
            cliente: { id: 7 },
          },
        ],
      ]) as never
    )
    vi.mocked(olistFetch).mockResolvedValue({
      id: 50,
      taxa: 16.34,
      valorPago: 0,
      dataLiquidacao: '',
      formaRecebimento: { id: 3, nome: 'Cartão de crédito' },
    })

    const { upsert } = mockAdmin()

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    const result = await syncAccountsReceivable(ORG_ID)

    expect(result.received).toBe(1)
    expect(olistFetch).toHaveBeenCalledWith(ORG_ID, '/contas-receber/50')
    const upsertedRow = upsert.mock.calls[0][0]
    expect(upsertedRow).toMatchObject({
      org_id: ORG_ID,
      olist_id: 50,
      cliente_olist_id: 7,
      taxa: 16.34,
      valor_pago: 0,
      data_liquidacao: null,
      forma_recebimento_id: 3,
      forma_recebimento_nome: 'Cartão de crédito',
    })
  })

  it('converts empty-string data/dataVencimento/dataLiquidacao to null before upserting', async () => {
    vi.mocked(paginateOlist).mockReturnValue(
      fakePages([
        [
          {
            id: 51,
            situacao: 'aberta',
            data: '',
            dataVencimento: '',
            historico: 'Sem datas',
            valor: 20,
            saldo: 20,
            numeroDocumento: 'D2',
            numeroBanco: 'B2',
            serieDocumento: null,
            quantidadeParcelasAntecipadas: 0,
            cliente: null,
          },
        ],
      ]) as never
    )
    vi.mocked(olistFetch).mockResolvedValue({
      id: 51,
      taxa: null,
      valorPago: null,
      dataLiquidacao: '',
      formaRecebimento: null,
    })

    const { upsert } = mockAdmin()

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    await syncAccountsReceivable(ORG_ID)

    const upsertedRow = upsert.mock.calls[0][0]
    expect(upsertedRow).toMatchObject({
      data_emissao: null,
      data_vencimento: null,
      data_liquidacao: null,
      forma_recebimento_id: null,
      forma_recebimento_nome: null,
    })
  })

  it('defaults to a 90-day window when windowDays is not provided', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    await syncAccountsReceivable(ORG_ID)

    const call = vi.mocked(paginateOlist).mock.calls[0]
    expect(call[1]).toBe('/contas-receber')

    const expectedStart = new Date()
    expectedStart.setDate(expectedStart.getDate() - 90)
    expect((call[2] as { dataInicialVencimento: string }).dataInicialVencimento).toBe(
      toLocalDateParam(expectedStart)
    )
  })

  it('accepts an overridable windowDays option', async () => {
    vi.mocked(paginateOlist).mockReturnValue(fakePages([[]]) as never)

    const { syncAccountsReceivable } = await import('@/lib/olist/sync/accounts-receivable')
    await syncAccountsReceivable(ORG_ID, { windowDays: 60 })

    const call = vi.mocked(paginateOlist).mock.calls[0]

    const expectedStart60 = new Date()
    expectedStart60.setDate(expectedStart60.getDate() - 60)
    expect((call[2] as { dataInicialVencimento: string }).dataInicialVencimento).toBe(
      toLocalDateParam(expectedStart60)
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/olist/sync/accounts-receivable.test.ts`
Expected: FAIL — `olistFetch` is never called (current implementation only does bulk page upserts), and the new columns are absent from the upserted row.

- [ ] **Step 3: Implement the per-installment detail fetch**

Replace `lib/olist/sync/accounts-receivable.ts`:

```typescript
import { paginateOlist } from '@/lib/olist/paginate'
import { olistFetch } from '@/lib/olist/client'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam, emptyToNull } from '@/lib/integrations/date'

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

// Only exposed by the detail endpoint (GET /contas-receber/{id}), not the
// listing — see docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md,
// finding 4.
type OlistAccountReceivableDetail = {
  id: number
  taxa: number | null
  valorPago: number | null
  dataLiquidacao: string | null
  formaRecebimento?: { id: number; nome: string | null } | null
}

/**
 * Syncs accounts receivable via a sliding-window incremental strategy: the
 * Olist `/contas-receber` endpoint has no "updated since" filter, so every
 * sync run reprocesses the last `windowDays` days of `dataVencimento`
 * (default 90) up through all future-dated accounts, rather than filtering
 * by a last-synced timestamp like the other sync tasks. Mirrors Task 12's
 * accounts payable sync.
 *
 * As of Fase 4, also fetches the detail of every listed account (same N+1
 * pattern as `syncOrders`) to bring in `taxa`, `formaRecebimento`, and
 * `dataLiquidacao` — none of which the listing response includes, and all
 * of which the reconciliation engine needs. Fetching detail for every
 * account (not just card ones) is intentional: the listing gives no way to
 * know the payment method ahead of time, and the observed volume (~625
 * accounts on the real WEE account) is well within the rate limit already
 * enforced by `lib/olist/client.ts`.
 */
export async function syncAccountsReceivable(
  orgId: string,
  options: { windowDays?: number } = {}
): Promise<{ received: number }> {
  const admin = createAdminSupabaseClient()
  let received = 0

  const windowDays = options.windowDays ?? 90
  const windowStart = new Date()
  windowStart.setDate(windowStart.getDate() - windowDays)

  const query = { dataInicialVencimento: toLocalDateParam(windowStart) }

  for await (const page of paginateOlist<OlistAccountReceivable>(orgId, '/contas-receber', query)) {
    for (const account of page) {
      received += 1

      const detail = await olistFetch<OlistAccountReceivableDetail>(orgId, `/contas-receber/${account.id}`)

      const row = {
        org_id: orgId,
        olist_id: account.id,
        situacao: account.situacao,
        data_emissao: emptyToNull(account.data),
        data_vencimento: emptyToNull(account.dataVencimento),
        historico: account.historico,
        valor: account.valor,
        saldo: account.saldo,
        numero_documento: account.numeroDocumento,
        numero_banco: account.numeroBanco,
        serie_documento: account.serieDocumento ?? null,
        cliente_olist_id: account.cliente?.id ?? null,
        quantidade_parcelas_antecipadas: account.quantidadeParcelasAntecipadas,
        taxa: detail.taxa,
        valor_pago: detail.valorPago,
        forma_recebimento_id: detail.formaRecebimento?.id ?? null,
        forma_recebimento_nome: detail.formaRecebimento?.nome ?? null,
        data_liquidacao: emptyToNull(detail.dataLiquidacao),
        raw: { ...account, detail },
        synced_at: new Date().toISOString(),
      }

      const { error } = await admin.from('olist_accounts_receivable').upsert(row, { onConflict: 'org_id,olist_id' })
      if (error) throw new Error(`Failed to upsert olist_accounts_receivable ${account.id}: ${error.message}`)
    }
  }

  return { received }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/olist/sync/accounts-receivable.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/olist/sync/accounts-receivable.ts tests/unit/olist/sync/accounts-receivable.test.ts
git commit -m "feat: fetch per-installment fee, payment method, and settlement detail in the Olist AR sync"
```

---

### Task 3: Reconciliation matching — pure helpers

**Files:**
- Create: `lib/reconciliation/match.ts`
- Test: `tests/unit/reconciliation/match.test.ts`

**Interfaces:**
- Produces:
  - `isCardPaymentMethod(formaRecebimentoNome: string | null): boolean`
  - `parseInstallmentNumber(numeroDocumento: string | null): number | null`
  - `computeGrossEstimate(transactionAmount: number, installmentsCount: number): number | null`
  - `withinAmountTolerance(a: number, b: number): boolean`
  - `withinDateWindow(dateA: string, dateB: string): boolean`
  - `type MatchCandidate = { sumupTransactionEventId: string; sumupTransactionId: string; dueDate: string; grossEstimate: number }`
  - `type MatchResult` (discriminated union on `status`, see code below)
  - `classifyCandidates(arValor: number, candidates: MatchCandidate[]): MatchResult`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import {
  isCardPaymentMethod,
  parseInstallmentNumber,
  computeGrossEstimate,
  withinAmountTolerance,
  withinDateWindow,
  classifyCandidates,
  type MatchCandidate,
} from '@/lib/reconciliation/match'

describe('isCardPaymentMethod', () => {
  it('accepts credit and debit card, rejects everything else including null', () => {
    expect(isCardPaymentMethod('Cartão de crédito')).toBe(true)
    expect(isCardPaymentMethod('Cartão de débito')).toBe(true)
    expect(isCardPaymentMethod('Pix')).toBe(false)
    expect(isCardPaymentMethod('Boleto')).toBe(false)
    expect(isCardPaymentMethod(null)).toBe(false)
  })
})

describe('parseInstallmentNumber', () => {
  it('parses the trailing /NN of a real numeroDocumento', () => {
    expect(parseInstallmentNumber('000516/03')).toBe(3)
  })

  it('returns null for a document with no installment suffix', () => {
    expect(parseInstallmentNumber('D1')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(parseInstallmentNumber(null)).toBeNull()
  })

  it('returns null for a zero installment number', () => {
    expect(parseInstallmentNumber('000516/00')).toBeNull()
  })
})

describe('computeGrossEstimate', () => {
  it('divides transaction amount by installments and rounds to the cent', () => {
    // 8092 / 10 = 809.2
    expect(computeGrossEstimate(8092, 10)).toBe(809.2)
  })

  it('returns null when installmentsCount is zero or missing', () => {
    expect(computeGrossEstimate(100, 0)).toBeNull()
  })
})

describe('withinAmountTolerance', () => {
  it('accepts a difference of exactly R$ 0.05', () => {
    expect(withinAmountTolerance(380, 379.95)).toBe(true)
  })

  it('rejects a difference greater than R$ 0.05', () => {
    expect(withinAmountTolerance(380, 379.9)).toBe(false)
  })
})

describe('withinDateWindow', () => {
  it('accepts exactly 5 days apart', () => {
    expect(withinDateWindow('2026-02-01', '2026-02-06')).toBe(true)
  })

  it('rejects 6 days apart', () => {
    expect(withinDateWindow('2026-02-01', '2026-02-07')).toBe(false)
  })
})

describe('classifyCandidates', () => {
  const candidate = (overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
    sumupTransactionEventId: 'event-1',
    sumupTransactionId: 'tx-1',
    dueDate: '2026-02-02',
    grossEstimate: 380,
    ...overrides,
  })

  it('returns nao_reconciliado with zero candidates', () => {
    const result = classifyCandidates(380, [])
    expect(result.status).toBe('nao_reconciliado')
  })

  it('returns reconciliado_automaticamente with exactly one candidate', () => {
    const result = classifyCandidates(380, [candidate()])
    expect(result).toMatchObject({
      status: 'reconciliado_automaticamente',
      sumupTransactionEventId: 'event-1',
      sumupTransactionId: 'tx-1',
    })
  })

  it('returns conflito with more than one candidate, listing every candidate id', () => {
    const result = classifyCandidates(380, [
      candidate({ sumupTransactionEventId: 'event-1' }),
      candidate({ sumupTransactionEventId: 'event-2' }),
    ])
    expect(result.status).toBe('conflito')
    expect(result.status === 'conflito' && result.candidateIds).toEqual(['event-1', 'event-2'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/reconciliation/match.test.ts`
Expected: FAIL with "Cannot find module '@/lib/reconciliation/match'"

- [ ] **Step 3: Implement the matching helpers**

```typescript
const AMOUNT_TOLERANCE = 0.05
const DATE_WINDOW_DAYS = 5
const CARD_PAYMENT_METHODS = ['Cartão de crédito', 'Cartão de débito']

export function isCardPaymentMethod(formaRecebimentoNome: string | null): boolean {
  return formaRecebimentoNome !== null && CARD_PAYMENT_METHODS.includes(formaRecebimentoNome)
}

/**
 * `numeroDocumento` comes back from Olist as "<documento>/<parcela>", e.g.
 * "000516/03" for installment 3 of NF 516 (see
 * docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md, finding
 * 2). Returns null when the format doesn't match — non-installment
 * documents then fall through to `nao_reconciliado` instead of guessing.
 */
export function parseInstallmentNumber(numeroDocumento: string | null): number | null {
  if (!numeroDocumento) return null
  const match = /\/(\d+)$/.exec(numeroDocumento.trim())
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * SumUp's per-installment event amount is already net of SumUp's fee (spec
 * finding 3), so it can't be compared directly to the Olist gross
 * installment value. The transaction's total gross amount divided by its
 * installment count is the best available gross-per-installment estimate.
 */
export function computeGrossEstimate(transactionAmount: number, installmentsCount: number): number | null {
  if (!installmentsCount || installmentsCount <= 0) return null
  return Math.round((transactionAmount / installmentsCount) * 100) / 100
}

export function withinAmountTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE
}

export function withinDateWindow(dateA: string, dateB: string): boolean {
  const diffMs = Math.abs(new Date(dateA).getTime() - new Date(dateB).getTime())
  return diffMs <= DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000
}

export type MatchCandidate = {
  sumupTransactionEventId: string
  sumupTransactionId: string
  dueDate: string
  grossEstimate: number
}

export type MatchResult =
  | { status: 'nao_reconciliado'; matchReason: Record<string, unknown> }
  | {
      status: 'reconciliado_automaticamente'
      sumupTransactionEventId: string
      sumupTransactionId: string
      matchReason: Record<string, unknown>
    }
  | { status: 'conflito'; candidateIds: string[]; matchReason: Record<string, unknown> }

export function classifyCandidates(arValor: number, candidates: MatchCandidate[]): MatchResult {
  if (candidates.length === 0) {
    return {
      status: 'nao_reconciliado',
      matchReason: { motivo: 'nenhum_candidato_encontrado', candidatosAvaliados: 0 },
    }
  }

  if (candidates.length === 1) {
    const candidate = candidates[0]
    return {
      status: 'reconciliado_automaticamente',
      sumupTransactionEventId: candidate.sumupTransactionEventId,
      sumupTransactionId: candidate.sumupTransactionId,
      matchReason: {
        valorBrutoOlist: arValor,
        valorBrutoSumupEstimado: candidate.grossEstimate,
        diferencaValor: Math.round((arValor - candidate.grossEstimate) * 100) / 100,
      },
    }
  }

  return {
    status: 'conflito',
    candidateIds: candidates.map((candidate) => candidate.sumupTransactionEventId),
    matchReason: { motivo: 'multiplos_candidatos', candidatosAvaliados: candidates.length },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/reconciliation/match.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/reconciliation/match.ts tests/unit/reconciliation/match.test.ts
git commit -m "feat: add pure reconciliation matching helpers (installment parsing, gross estimate, tolerance, classification)"
```

---

### Task 4: Reconciliation runner — DB-driven engine

**Files:**
- Create: `lib/reconciliation/run.ts`
- Create: `lib/reconciliation/index.ts`
- Test: `tests/unit/reconciliation/run.test.ts`

**Interfaces:**
- Consumes: `isCardPaymentMethod`, `parseInstallmentNumber`, `computeGrossEstimate`, `withinAmountTolerance`, `withinDateWindow`, `classifyCandidates`, `MatchCandidate` from `@/lib/reconciliation/match` (Task 3); `createAdminSupabaseClient` from `@/lib/supabase/admin`; `toLocalDateParam` from `@/lib/integrations/date`.
- Produces: `runReconciliation(orgId: string): Promise<{ processed: number }>`, re-exported from `lib/reconciliation/index.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Builds a fake admin client whose `.from(table)` branches by table name.
 * `resolvedIds`/`arRows` back the two read queries `runReconciliation` issues
 * up front; `eventRowsByArId` backs the per-AR-row candidate query, keyed by
 * the AR row's `id` so each test can hand back different candidate sets.
 */
function mockAdmin(options: {
  resolvedIds?: string[]
  arRows?: Array<{
    id: string
    valor: number | null
    data_vencimento: string | null
    numero_documento: string | null
    forma_recebimento_nome: string | null
  }>
  eventRowsByArId?: Record<string, unknown[]>
  upsertError?: { message: string } | null
}) {
  const resolvedIds = options.resolvedIds ?? []
  const arRows = options.arRows ?? []
  const eventRowsByArId = options.eventRowsByArId ?? {}
  const upsert = vi.fn().mockResolvedValue({ error: options.upsertError ?? null })

  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_matches') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: resolvedIds.map((id) => ({ olist_accounts_receivable_id: id })), error: null }),
          }),
        }),
        upsert,
      }
    }
    if (table === 'olist_accounts_receivable') {
      const chain = {
        eq: vi.fn().mockReturnValue(chain),
        in: vi.fn().mockReturnValue(chain),
        not: vi.fn().mockReturnValue(chain),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: arRows, error: null }),
      }
      return { select: vi.fn().mockReturnValue(chain) }
    }
    if (table === 'sumup_transaction_events') {
      // Each call in matchOne() is scoped to one AR row's installment_number
      // filter; the test controls the outcome per AR row id via a closure
      // variable set right before the call in each test.
      const chain = {
        eq: vi.fn().mockReturnValue(chain),
        gte: vi.fn().mockReturnValue(chain),
        lte: vi.fn().mockReturnValue(chain),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: currentEventRows, error: null }),
      }
      return { select: vi.fn().mockReturnValue(chain) }
    }
    throw new Error(`unexpected table ${table}`)
  })

  let currentEventRows: unknown[] = []
  const setEventRowsFor = (arId: string) => {
    currentEventRows = eventRowsByArId[arId] ?? []
  }

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { upsert, setEventRowsFor }
}

describe('runReconciliation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('marks nao_reconciliado when no candidate events exist', async () => {
    const { upsert, setEventRowsFor } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          data_vencimento: '2026-02-01',
          numero_documento: '000516/03',
          forma_recebimento_nome: 'Cartão de crédito',
        },
      ],
      eventRowsByArId: { 'ar-1': [] },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    const result = await runReconciliation(ORG_ID)

    expect(result.processed).toBe(1)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ olist_accounts_receivable_id: 'ar-1', status: 'nao_reconciliado' }),
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )
  })

  it('marks reconciliado_automaticamente with exactly one matching candidate', async () => {
    const { upsert, setEventRowsFor } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 809.2,
          data_vencimento: '2026-02-01',
          numero_documento: '000516/10',
          forma_recebimento_nome: 'Cartão de crédito',
        },
      ],
      eventRowsByArId: {
        'ar-1': [
          {
            id: 'event-1',
            due_date: '2026-02-02',
            installment_number: 10,
            sumup_transactions: { id: 'tx-1', amount: 8092, installments_count: 10, status: 'SUCCESSFUL' },
          },
        ],
      },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        olist_accounts_receivable_id: 'ar-1',
        status: 'reconciliado_automaticamente',
        sumup_transaction_id: 'tx-1',
        sumup_transaction_event_id: 'event-1',
      }),
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )
  })

  it('marks conflito with more than one matching candidate and records every candidate id', async () => {
    const { upsert, setEventRowsFor } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 809.2,
          data_vencimento: '2026-02-01',
          numero_documento: '000516/10',
          forma_recebimento_nome: 'Cartão de crédito',
        },
      ],
      eventRowsByArId: {
        'ar-1': [
          {
            id: 'event-1',
            due_date: '2026-02-02',
            installment_number: 10,
            sumup_transactions: { id: 'tx-1', amount: 8092, installments_count: 10, status: 'SUCCESSFUL' },
          },
          {
            id: 'event-2',
            due_date: '2026-02-03',
            installment_number: 10,
            sumup_transactions: { id: 'tx-2', amount: 8092, installments_count: 10, status: 'SUCCESSFUL' },
          },
        ],
      },
    })
    setEventRowsFor('ar-1')

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        olist_accounts_receivable_id: 'ar-1',
        status: 'conflito',
        candidate_ids: ['event-1', 'event-2'],
        sumup_transaction_id: null,
        sumup_transaction_event_id: null,
      }),
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )
  })

  it('never reprocesses an AR row that already has a resolved reconciliation_matches row', async () => {
    const { upsert } = mockAdmin({
      resolvedIds: ['ar-1'],
      arRows: [], // the runner's own AR query excludes resolved ids — simulated here by an empty result
    })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    const result = await runReconciliation(ORG_ID)

    expect(result.processed).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('marks nao_reconciliado when numeroDocumento has no parseable installment number', async () => {
    const { upsert } = mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          data_vencimento: '2026-02-01',
          numero_documento: 'SEM-PARCELA',
          forma_recebimento_nome: 'Cartão de crédito',
        },
      ],
    })

    const { runReconciliation } = await import('@/lib/reconciliation/run')
    await runReconciliation(ORG_ID)

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ olist_accounts_receivable_id: 'ar-1', status: 'nao_reconciliado' }),
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/reconciliation/run.test.ts`
Expected: FAIL with "Cannot find module '@/lib/reconciliation/run'"

- [ ] **Step 3: Implement the runner**

```typescript
// lib/reconciliation/run.ts
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam } from '@/lib/integrations/date'
import {
  parseInstallmentNumber,
  computeGrossEstimate,
  withinAmountTolerance,
  withinDateWindow,
  classifyCandidates,
  type MatchCandidate,
} from '@/lib/reconciliation/match'

const RESOLVED_STATUSES = ['reconciliado_automaticamente', 'reconciliado_manualmente']
const CARD_PAYMENT_METHODS = ['Cartão de crédito', 'Cartão de débito']
const DATE_WINDOW_DAYS = 5

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

type AccountsReceivableRow = {
  id: string
  valor: number | null
  data_vencimento: string | null
  numero_documento: string | null
  forma_recebimento_nome: string | null
}

type SumupEventCandidateRow = {
  id: string
  due_date: string | null
  installment_number: number | null
  sumup_transactions: {
    id: string
    amount: number | null
    installments_count: number | null
    status: string | null
  } | null
}

/**
 * Runs the matching engine over every card-paid AR installment that doesn't
 * already have a resolved (auto or manual) `reconciliation_matches` row.
 * Idempotent: re-running never touches a row already resolved, and upserts
 * (rather than inserts) everything else — see the unique constraint on
 * `(org_id, olist_accounts_receivable_id)`.
 */
export async function runReconciliation(orgId: string): Promise<{ processed: number }> {
  const admin = createAdminSupabaseClient()
  let processed = 0

  const { data: resolvedRows, error: resolvedError } = await admin
    .from('reconciliation_matches')
    .select('olist_accounts_receivable_id')
    .eq('org_id', orgId)
    .in('status', RESOLVED_STATUSES)

  if (resolvedError) {
    throw new Error(`Failed to load resolved reconciliation_matches: ${resolvedError.message}`)
  }

  const resolvedIds = (resolvedRows ?? []).map((row) => row.olist_accounts_receivable_id as string)

  let arQuery = admin
    .from('olist_accounts_receivable')
    .select('id, valor, data_vencimento, numero_documento, forma_recebimento_nome')
    .eq('org_id', orgId)
    .in('forma_recebimento_nome', CARD_PAYMENT_METHODS)

  if (resolvedIds.length > 0) {
    arQuery = arQuery.not('id', 'in', `(${resolvedIds.join(',')})`)
  }

  const { data: arRows, error: arError } = await arQuery

  if (arError) {
    throw new Error(`Failed to load olist_accounts_receivable candidates: ${arError.message}`)
  }

  for (const ar of (arRows ?? []) as AccountsReceivableRow[]) {
    processed += 1

    const result = await matchOne(admin, orgId, ar)

    const sumupTransactionId = result.status === 'reconciliado_automaticamente' ? result.sumupTransactionId : null
    const sumupTransactionEventId =
      result.status === 'reconciliado_automaticamente' ? result.sumupTransactionEventId : null
    const candidateIds = result.status === 'conflito' ? result.candidateIds : []

    const { error: upsertError } = await admin.from('reconciliation_matches').upsert(
      {
        org_id: orgId,
        olist_accounts_receivable_id: ar.id,
        sumup_transaction_id: sumupTransactionId,
        sumup_transaction_event_id: sumupTransactionEventId,
        status: result.status,
        match_reason: result.matchReason,
        candidate_ids: candidateIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,olist_accounts_receivable_id' }
    )

    if (upsertError) {
      throw new Error(`Failed to upsert reconciliation_matches for ${ar.id}: ${upsertError.message}`)
    }
  }

  return { processed }
}

async function matchOne(admin: AdminClient, orgId: string, ar: AccountsReceivableRow) {
  if (!ar.valor || !ar.data_vencimento) {
    return { status: 'nao_reconciliado' as const, matchReason: { motivo: 'valor_ou_vencimento_ausente' } }
  }

  const installmentNumber = parseInstallmentNumber(ar.numero_documento)
  if (installmentNumber === null) {
    return { status: 'nao_reconciliado' as const, matchReason: { motivo: 'numero_parcela_nao_identificado' } }
  }

  const dueDate = new Date(ar.data_vencimento)
  const windowStart = new Date(dueDate)
  windowStart.setDate(windowStart.getDate() - DATE_WINDOW_DAYS)
  const windowEnd = new Date(dueDate)
  windowEnd.setDate(windowEnd.getDate() + DATE_WINDOW_DAYS)

  // The date bounds are pushed into the query itself; `withinDateWindow`
  // below is a defensive re-check against day-boundary/timezone drift
  // between this JS Date math and Postgres date comparison, not the
  // primary filter.
  const { data: eventRows, error } = await admin
    .from('sumup_transaction_events')
    .select('id, due_date, installment_number, sumup_transactions!inner(id, amount, installments_count, status)')
    .eq('org_id', orgId)
    .eq('event_type', 'PAYOUT')
    .eq('installment_number', installmentNumber)
    .gte('due_date', toLocalDateParam(windowStart))
    .lte('due_date', toLocalDateParam(windowEnd))
    .eq('sumup_transactions.status', 'SUCCESSFUL')

  if (error) {
    throw new Error(`Failed to load sumup_transaction_events candidates: ${error.message}`)
  }

  const candidates: MatchCandidate[] = []
  for (const row of (eventRows ?? []) as unknown as SumupEventCandidateRow[]) {
    const transaction = row.sumup_transactions
    if (!transaction || transaction.amount === null || !transaction.installments_count) continue
    if (!row.due_date || !withinDateWindow(ar.data_vencimento, row.due_date)) continue

    const grossEstimate = computeGrossEstimate(transaction.amount, transaction.installments_count)
    if (grossEstimate === null || !withinAmountTolerance(ar.valor, grossEstimate)) continue

    candidates.push({
      sumupTransactionEventId: row.id,
      sumupTransactionId: transaction.id,
      dueDate: row.due_date,
      grossEstimate,
    })
  }

  return classifyCandidates(ar.valor, candidates)
}
```

```typescript
// lib/reconciliation/index.ts
export { runReconciliation } from '@/lib/reconciliation/run'
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/reconciliation/run.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/reconciliation/run.ts lib/reconciliation/index.ts tests/unit/reconciliation/run.test.ts
git commit -m "feat: add the reconciliation engine runner (queries unresolved card AR rows, matches against SumUp PAYOUT events, upserts reconciliation_matches)"
```

---

### Task 5: Wire the engine into both sync orchestrators

**Files:**
- Modify: `lib/olist/sync/index.ts`
- Modify: `lib/sumup/sync/index.ts`
- Modify: `tests/unit/olist/sync/index.test.ts`
- Modify: `tests/unit/sumup/sync/index.test.ts`

**Interfaces:**
- Consumes: `runReconciliation(orgId: string): Promise<{ processed: number }>` from `@/lib/reconciliation` (Task 4).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/olist/sync/index.test.ts` — insert the mock alongside the existing ones near the top:

```typescript
vi.mock('@/lib/reconciliation', () => ({ runReconciliation: vi.fn().mockResolvedValue({ processed: 0 }) }))
```

and import it alongside the other imports:

```typescript
import { runReconciliation } from '@/lib/reconciliation'
```

Then add these two `it` blocks inside `describe('runOlistSync', ...)`:

```typescript
  it('runs reconciliation after a successful sync, before marking sync_runs success', async () => {
    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await runOlistSync(ORG_ID, 'initial')

    expect(runReconciliation).toHaveBeenCalledWith(ORG_ID)
    const reconciliationCallOrder = vi.mocked(runReconciliation).mock.invocationCallOrder[0]
    const finishCallOrder = vi.mocked(finishSyncRun).mock.invocationCallOrder[0]
    expect(reconciliationCallOrder).toBeLessThan(finishCallOrder)
  })

  it('marks the run failed and rethrows when reconciliation throws', async () => {
    vi.mocked(runReconciliation).mockRejectedValueOnce(new Error('reconciliation boom'))

    const { runOlistSync } = await import('@/lib/olist/sync/index')
    await expect(runOlistSync(ORG_ID, 'initial')).rejects.toThrow('reconciliation boom')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('reconciliation boom') })
    )
  })
```

Add the equivalent to `tests/unit/sumup/sync/index.test.ts`:

```typescript
vi.mock('@/lib/reconciliation', () => ({ runReconciliation: vi.fn().mockResolvedValue({ processed: 0 }) }))
```

```typescript
import { runReconciliation } from '@/lib/reconciliation'
```

```typescript
  it('runs reconciliation after both legs succeed, before marking sync_runs success', async () => {
    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await runSumupSync(ORG_ID, 'initial')

    expect(runReconciliation).toHaveBeenCalledWith(ORG_ID)
  })

  it('does not run reconciliation when a leg fails', async () => {
    vi.mocked(syncSumupPayouts).mockRejectedValueOnce(new Error('boom'))

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('boom')

    expect(runReconciliation).not.toHaveBeenCalled()
  })

  it('marks the run failed and rethrows when reconciliation throws', async () => {
    vi.mocked(runReconciliation).mockRejectedValueOnce(new Error('reconciliation boom'))

    const { runSumupSync } = await import('@/lib/sumup/sync/index')
    await expect(runSumupSync(ORG_ID, 'initial')).rejects.toThrow('reconciliation boom')

    expect(finishSyncRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', errorMessage: expect.stringContaining('reconciliation boom') })
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/olist/sync/index.test.ts tests/unit/sumup/sync/index.test.ts`
Expected: FAIL — `runReconciliation` is never called by either orchestrator yet.

- [ ] **Step 3: Wire `runReconciliation` into both orchestrators**

In `lib/olist/sync/index.ts`, add the import:

```typescript
import { runReconciliation } from '@/lib/reconciliation'
```

and call it right before the success `finishSyncRun`, inside the existing `try` block:

```typescript
    for (const result of [sellers, paymentMethods, contacts, products, orders, accountsPayable, accountsReceivable]) {
      received += result.received
    }

    await runReconciliation(orgId)

    await finishSyncRun(runId, {
      status: 'success',
      recordsReceived: received,
      recordsCreated: null,
      recordsUpdated: null,
      errorCount: 0,
    })
```

(No other change needed — the existing `catch` block already marks the run `failed` and rethrows for anything thrown inside the `try`.)

In `lib/sumup/sync/index.ts`, add the import:

```typescript
import { runReconciliation } from '@/lib/reconciliation'
```

and wrap the success branch so a reconciliation failure still records a `failed` sync run (this orchestrator has no single outer `try/catch`, unlike the Olist one):

```typescript
  if (errors.length === 0) {
    try {
      await runReconciliation(orgId)
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

    await finishSyncRun(runId, {
      status: 'success',
      recordsReceived: received,
      recordsCreated: null,
      recordsUpdated: null,
      errorCount: 0,
    })
    return
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/olist/sync/index.test.ts tests/unit/sumup/sync/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/olist/sync/index.ts lib/sumup/sync/index.ts tests/unit/olist/sync/index.test.ts tests/unit/sumup/sync/index.test.ts
git commit -m "feat: run the reconciliation engine automatically after every successful Olist/SumUp sync"
```

---

### Task 6: RBAC — `canManageReconciliation`

**Files:**
- Modify: `lib/auth/rbac.ts`
- Modify: `tests/unit/auth/rbac.test.ts`

**Interfaces:**
- Produces: `canManageReconciliation(role: OrganizationRole): boolean` — `true` for `OWNER_ADMIN`/`MANAGER`, `false` for `VIEWER`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/auth/rbac.test.ts`, alongside the existing imports and tests:

```typescript
import {
  canManageUsers,
  canManageIntegrations,
  canEditForecast,
  canCreateScenario,
  canManageReconciliation,
} from '@/lib/auth/rbac'
```

```typescript
  it('OWNER_ADMIN and MANAGER can manage reconciliation, VIEWER cannot', () => {
    expect(canManageReconciliation('OWNER_ADMIN')).toBe(true)
    expect(canManageReconciliation('MANAGER')).toBe(true)
    expect(canManageReconciliation('VIEWER')).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/auth/rbac.test.ts`
Expected: FAIL — `canManageReconciliation` is not exported

- [ ] **Step 3: Implement**

Add to `lib/auth/rbac.ts`:

```typescript
export function canManageReconciliation(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN' || role === 'MANAGER'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/auth/rbac.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/auth/rbac.ts tests/unit/auth/rbac.test.ts
git commit -m "feat: add canManageReconciliation RBAC predicate (OWNER_ADMIN and MANAGER)"
```

---

### Task 7: API route — confirm a conflict candidate

**Files:**
- Create: `app/api/reconciliacao/[id]/confirmar/route.ts`
- Test: `tests/unit/reconciliation/confirmar-route.test.ts`

**Interfaces:**
- Consumes: `getCurrentMember` from `@/lib/auth/session`; `canManageReconciliation` from `@/lib/auth/rbac` (Task 6); `createAdminSupabaseClient` from `@/lib/supabase/admin`.
- Produces: `POST` handler at `/api/reconciliacao/[id]/confirmar`, body `{ sumupTransactionEventId: string }`. On success, sets the `reconciliation_matches` row's `status` to `reconciliado_manualmente`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageReconciliation: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }
const MATCH_ID = 'match-1'

function buildRequest(body: unknown) {
  return new Request(`http://localhost/api/reconciliacao/${MATCH_ID}/confirmar`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function ctx() {
  return { params: Promise.resolve({ id: MATCH_ID }) }
}

function mockAdmin(options: {
  match?: { id: string; candidate_ids: string[]; status: string } | null
  event?: { id: string; transaction_id: string } | null
  updateError?: { message: string } | null
}) {
  const matchMaybeSingle = vi.fn().mockResolvedValue({ data: options.match ?? null, error: null })
  const matchEq2 = vi.fn().mockReturnValue({ maybeSingle: matchMaybeSingle })
  const matchEq1 = vi.fn().mockReturnValue({ eq: matchEq2 })
  const matchSelect = vi.fn().mockReturnValue({ eq: matchEq1 })

  const eventMaybeSingle = vi.fn().mockResolvedValue({ data: options.event ?? null, error: null })
  const eventEq2 = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
  const eventEq1 = vi.fn().mockReturnValue({ eq: eventEq2 })
  const eventSelect = vi.fn().mockReturnValue({ eq: eventEq1 })

  const updateEq2 = vi.fn().mockResolvedValue({ error: options.updateError ?? null })
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
  const update = vi.fn().mockReturnValue({ eq: updateEq1 })

  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_matches') return { select: matchSelect, update }
    if (table === 'sumup_transaction_events') return { select: eventSelect }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { update }
}

describe('POST /api/reconciliacao/[id]/confirmar', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canManageReconciliation', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canManageReconciliation).mockReturnValue(false)

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())

    expect(response.status).toBe(403)
  })

  it('returns 400 when sumupTransactionEventId is missing', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({}), ctx())

    expect(response.status).toBe(400)
  })

  it('returns 404 when the match does not exist in the caller org', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    mockAdmin({ match: null })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())

    expect(response.status).toBe(404)
  })

  it('returns 409 when the match status is not conflito', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    mockAdmin({ match: { id: MATCH_ID, candidate_ids: ['event-1'], status: 'nao_reconciliado' } })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())

    expect(response.status).toBe(409)
  })

  it('returns 400 when sumupTransactionEventId is not one of the stored candidates', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    mockAdmin({ match: { id: MATCH_ID, candidate_ids: ['event-1', 'event-2'], status: 'conflito' } })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-999' }), ctx())

    expect(response.status).toBe(400)
  })

  it('confirms the match and returns ok when the candidate is valid', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    const { update } = mockAdmin({
      match: { id: MATCH_ID, candidate_ids: ['event-1', 'event-2'], status: 'conflito' },
      event: { id: 'event-1', transaction_id: 'tx-1' },
    })

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(buildRequest({ sumupTransactionEventId: 'event-1' }), ctx())
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'reconciliado_manualmente',
        sumup_transaction_event_id: 'event-1',
        sumup_transaction_id: 'tx-1',
        resolved_by: 'profile-1',
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/reconciliation/confirmar-route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/reconciliacao/[id]/confirmar/route'"

- [ ] **Step 3: Implement the route**

```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function POST(request: Request, ctx: RouteContext<'/api/reconciliacao/[id]/confirmar'>) {
  const member = await getCurrentMember()

  if (!member || !canManageReconciliation(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const sumupTransactionEventId = (body as { sumupTransactionEventId?: unknown } | null)?.sumupTransactionEventId

  if (typeof sumupTransactionEventId !== 'string' || sumupTransactionEventId.length === 0) {
    return NextResponse.json({ error: 'sumupTransactionEventId é obrigatório' }, { status: 400 })
  }

  const { id } = await ctx.params
  const admin = createAdminSupabaseClient()

  const { data: match, error: matchError } = await admin
    .from('reconciliation_matches')
    .select('id, candidate_ids, status')
    .eq('id', id)
    .eq('org_id', member.orgId)
    .maybeSingle()

  if (matchError) {
    return NextResponse.json({ error: matchError.message }, { status: 500 })
  }
  if (!match) {
    return NextResponse.json({ error: 'Registro de reconciliação não encontrado' }, { status: 404 })
  }
  if (match.status !== 'conflito') {
    return NextResponse.json(
      { error: 'Só é possível confirmar um candidato quando o status é conflito' },
      { status: 409 }
    )
  }

  const candidateIds = Array.isArray(match.candidate_ids) ? (match.candidate_ids as string[]) : []
  if (!candidateIds.includes(sumupTransactionEventId)) {
    return NextResponse.json(
      { error: 'sumupTransactionEventId não é um candidato válido para este registro' },
      { status: 400 }
    )
  }

  const { data: event, error: eventError } = await admin
    .from('sumup_transaction_events')
    .select('id, transaction_id')
    .eq('id', sumupTransactionEventId)
    .eq('org_id', member.orgId)
    .maybeSingle()

  if (eventError || !event) {
    return NextResponse.json({ error: 'Evento SumUp não encontrado' }, { status: 404 })
  }

  const { error: updateError } = await admin
    .from('reconciliation_matches')
    .update({
      status: 'reconciliado_manualmente',
      sumup_transaction_event_id: event.id,
      sumup_transaction_id: event.transaction_id,
      resolved_by: member.profileId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', member.orgId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/reconciliation/confirmar-route.test.ts`
Expected: PASS

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `RouteContext<'/api/reconciliacao/[id]/confirmar'>` resolves — this global type is generated by `next dev`/`next build`/`next typegen`; run `npx next typegen` first if `tsc` complains it can't find `RouteContext`)

- [ ] **Step 6: Commit**

```bash
git add app/api/reconciliacao/[id]/confirmar/route.ts tests/unit/reconciliation/confirmar-route.test.ts
git commit -m "feat: add route to manually confirm a reconciliation conflict candidate"
```

---

### Task 8: API route — undo a match

**Files:**
- Create: `app/api/reconciliacao/[id]/desfazer/route.ts`
- Test: `tests/unit/reconciliation/desfazer-route.test.ts`

**Interfaces:**
- Consumes: same as Task 7.
- Produces: `POST` handler at `/api/reconciliacao/[id]/desfazer`. Resets the match's `status` to `nao_reconciliado` and clears its resolution fields.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageReconciliation: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'OWNER_ADMIN' as const }
const MATCH_ID = 'match-1'

function buildRequest() {
  return new Request(`http://localhost/api/reconciliacao/${MATCH_ID}/desfazer`, { method: 'POST' })
}

function ctx() {
  return { params: Promise.resolve({ id: MATCH_ID }) }
}

function mockAdmin(options: { match?: { id: string } | null; updateError?: { message: string } | null }) {
  const matchMaybeSingle = vi.fn().mockResolvedValue({ data: options.match ?? null, error: null })
  const matchEq2 = vi.fn().mockReturnValue({ maybeSingle: matchMaybeSingle })
  const matchEq1 = vi.fn().mockReturnValue({ eq: matchEq2 })
  const matchSelect = vi.fn().mockReturnValue({ eq: matchEq1 })

  const updateEq2 = vi.fn().mockResolvedValue({ error: options.updateError ?? null })
  const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
  const update = vi.fn().mockReturnValue({ eq: updateEq1 })

  const from = vi.fn((table: string) => {
    if (table === 'reconciliation_matches') return { select: matchSelect, update }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { update }
}

describe('POST /api/reconciliacao/[id]/desfazer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    const response = await POST(buildRequest(), ctx())

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canManageReconciliation', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canManageReconciliation).mockReturnValue(false)

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    const response = await POST(buildRequest(), ctx())

    expect(response.status).toBe(403)
  })

  it('returns 404 when the match does not exist in the caller org', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    mockAdmin({ match: null })

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    const response = await POST(buildRequest(), ctx())

    expect(response.status).toBe(404)
  })

  it('resets the match to nao_reconciliado and returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    const { update } = mockAdmin({ match: { id: MATCH_ID } })

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    const response = await POST(buildRequest(), ctx())
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'nao_reconciliado',
        sumup_transaction_event_id: null,
        sumup_transaction_id: null,
        resolved_by: null,
        resolved_at: null,
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/reconciliation/desfazer-route.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/reconciliacao/[id]/desfazer/route'"

- [ ] **Step 3: Implement the route**

```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function POST(_request: Request, ctx: RouteContext<'/api/reconciliacao/[id]/desfazer'>) {
  const member = await getCurrentMember()

  if (!member || !canManageReconciliation(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const { id } = await ctx.params
  const admin = createAdminSupabaseClient()

  const { data: match, error: matchError } = await admin
    .from('reconciliation_matches')
    .select('id')
    .eq('id', id)
    .eq('org_id', member.orgId)
    .maybeSingle()

  if (matchError) {
    return NextResponse.json({ error: matchError.message }, { status: 500 })
  }
  if (!match) {
    return NextResponse.json({ error: 'Registro de reconciliação não encontrado' }, { status: 404 })
  }

  const { error: updateError } = await admin
    .from('reconciliation_matches')
    .update({
      status: 'nao_reconciliado',
      sumup_transaction_event_id: null,
      sumup_transaction_id: null,
      resolved_by: null,
      resolved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', member.orgId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/reconciliation/desfazer-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/reconciliacao/[id]/desfazer/route.ts tests/unit/reconciliation/desfazer-route.test.ts
git commit -m "feat: add route to undo a reconciliation match"
```

---

### Task 9: UI — Reconciliação page and table

**Files:**
- Create: `components/reconciliation/reconciliation-table.tsx`
- Modify: `app/(app)/reconciliacao/page.tsx`
- Test: `tests/unit/components/reconciliation-table.test.tsx`

**Interfaces:**
- Consumes: `formatBRL(value: number): string` from `@/lib/format/currency`; `formatDateBR(date: Date | string): string` from `@/lib/format/date`; `getCurrentMember` from `@/lib/auth/session`; `canManageReconciliation` from `@/lib/auth/rbac` (Task 6); `createServerSupabaseClient` from `@/lib/supabase/server`.
- Produces: `ReconciliationTable({ matches, canManage }: { matches: MatchRow[]; canManage: boolean }): JSX.Element`, exported `MatchRow` type; posts to `/api/reconciliacao/[id]/confirmar` (Task 7) and `/api/reconciliacao/[id]/desfazer` (Task 8).

- [ ] **Step 1: Write the failing component test**

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { ReconciliationTable } from '@/components/reconciliation/reconciliation-table'

const BASE_MATCH = {
  id: 'match-1',
  status: 'nao_reconciliado' as const,
  candidate_ids: [] as string[],
  olist_accounts_receivable: {
    historico: 'Ref. a NF nº 516, Giovana Dias (parcela 3/3)',
    numero_documento: '000516/03',
    valor: 380,
    data_vencimento: '2026-02-01',
  },
}

describe('ReconciliationTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no matches', () => {
    render(<ReconciliationTable matches={[]} canManage={true} />)
    expect(screen.getByText(/Nenhuma parcela/)).toBeTruthy()
  })

  it('renders a row per match with its formatted value', () => {
    render(<ReconciliationTable matches={[BASE_MATCH]} canManage={true} />)
    expect(screen.getByText('000516/03')).toBeTruthy()
    expect(screen.getByText('R$ 380,00')).toBeTruthy()
  })

  it('shows one confirm button per candidate when status is conflito and canManage is true', () => {
    render(
      <ReconciliationTable
        matches={[{ ...BASE_MATCH, status: 'conflito', candidate_ids: ['event-1', 'event-2'] }]}
        canManage={true}
      />
    )
    expect(screen.getAllByRole('button', { name: /Confirmar/ })).toHaveLength(2)
  })

  it('shows an undo button when status is reconciliado_automaticamente and canManage is true', () => {
    render(<ReconciliationTable matches={[{ ...BASE_MATCH, status: 'reconciliado_automaticamente' }]} canManage={true} />)
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeTruthy()
  })

  it('hides every action when canManage is false', () => {
    render(
      <ReconciliationTable
        matches={[{ ...BASE_MATCH, status: 'conflito', candidate_ids: ['event-1'] }]}
        canManage={false}
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/reconciliation-table.test.tsx`
Expected: FAIL with "Cannot find module '@/components/reconciliation/reconciliation-table'"

- [ ] **Step 3: Implement the table component**

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBRL } from '@/lib/format/currency'
import { formatDateBR } from '@/lib/format/date'

export type MatchStatus = 'reconciliado_automaticamente' | 'reconciliado_manualmente' | 'nao_reconciliado' | 'conflito'

export type MatchRow = {
  id: string
  status: MatchStatus
  candidate_ids: string[]
  olist_accounts_receivable: {
    historico: string | null
    numero_documento: string | null
    valor: number | null
    data_vencimento: string | null
  } | null
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  reconciliado_automaticamente: 'Reconciliado (automático)',
  reconciliado_manualmente: 'Reconciliado (manual)',
  nao_reconciliado: 'Não reconciliado',
  conflito: 'Conflito',
}

const RESOLVED_STATUSES: MatchStatus[] = ['reconciliado_automaticamente', 'reconciliado_manualmente']

export function ReconciliationTable({ matches, canManage }: { matches: MatchRow[]; canManage: boolean }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function confirmCandidate(matchId: string, sumupTransactionEventId: string) {
    setPendingId(matchId)
    setError(null)
    try {
      const response = await fetch(`/api/reconciliacao/${matchId}/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sumupTransactionEventId }),
      })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        setError(data.error ?? 'Falha ao confirmar')
      } else {
        router.refresh()
      }
    } catch {
      setError('Falha ao confirmar')
    } finally {
      setPendingId(null)
    }
  }

  async function undoMatch(matchId: string) {
    setPendingId(matchId)
    setError(null)
    try {
      const response = await fetch(`/api/reconciliacao/${matchId}/desfazer`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok || !data.ok) {
        setError(data.error ?? 'Falha ao desfazer')
      } else {
        router.refresh()
      }
    } catch {
      setError('Falha ao desfazer')
    } finally {
      setPendingId(null)
    }
  }

  if (matches.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhuma parcela para reconciliar ainda.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-medium">Parcela</th>
            <th className="px-3 py-2 font-medium">Vencimento</th>
            <th className="px-3 py-2 font-medium">Valor</th>
            <th className="px-3 py-2 font-medium">Status</th>
            {canManage && <th className="px-3 py-2 font-medium">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => {
            const ar = match.olist_accounts_receivable
            return (
              <tr key={match.id} className="border-b last:border-0">
                <td className="px-3 py-2">{ar?.numero_documento ?? ar?.historico ?? '—'}</td>
                <td className="px-3 py-2">{ar?.data_vencimento ? formatDateBR(ar.data_vencimento) : '—'}</td>
                <td className="px-3 py-2">{ar?.valor != null ? formatBRL(ar.valor) : '—'}</td>
                <td className="px-3 py-2">{STATUS_LABEL[match.status]}</td>
                {canManage && (
                  <td className="px-3 py-2">
                    {match.status === 'conflito' && (
                      <div className="flex flex-wrap gap-1">
                        {match.candidate_ids.map((candidateId) => (
                          <button
                            key={candidateId}
                            onClick={() => confirmCandidate(match.id, candidateId)}
                            disabled={pendingId === match.id}
                            className="rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Confirmar {candidateId.slice(0, 8)}
                          </button>
                        ))}
                      </div>
                    )}
                    {RESOLVED_STATUSES.includes(match.status) && (
                      <button
                        onClick={() => undoMatch(match.id)}
                        disabled={pendingId === match.id}
                        className="rounded border px-2 py-1 text-xs font-medium disabled:opacity-50"
                      >
                        Desfazer
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Wire the table into the Reconciliação page**

Replace `app/(app)/reconciliacao/page.tsx`:

```typescript
import { getCurrentMember } from '@/lib/auth/session'
import { canManageReconciliation } from '@/lib/auth/rbac'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { ReconciliationTable, type MatchRow } from '@/components/reconciliation/reconciliation-table'

export default async function ReconciliacaoPage() {
  const member = await getCurrentMember()

  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver a reconciliação.</p>
  }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('reconciliation_matches')
    .select(
      'id, status, candidate_ids, olist_accounts_receivable:olist_accounts_receivable_id (historico, numero_documento, valor, data_vencimento)'
    )
    .order('status', { ascending: true })

  if (error) {
    throw new Error(`Falha ao carregar reconciliação: ${error.message}`)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Reconciliação Financeira</h1>
      <ReconciliationTable matches={(data ?? []) as unknown as MatchRow[]} canManage={canManageReconciliation(member.role)} />
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/reconciliation-table.test.tsx`
Expected: PASS

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 8: Manual verification (optional, documented if attempted)**

If you have a local Supabase instance with real synced Olist/SumUp data: run `npm run dev`, sign in as an `OWNER_ADMIN` or `MANAGER`, trigger a sync from `/integracoes`, then open `/reconciliacao` and confirm rows show up with plausible statuses (mostly `nao_reconciliado` is expected on first run, since matching depends on `sumup_transaction_events` already existing with `event_type='PAYOUT'`, `status='SUCCESSFUL'`, and a due date near the AR's `data_vencimento`). Also verify `VIEWER` sees the table with no action buttons. Document what you tried and observed even if you could not run this (no real synced data available, etc.).

- [ ] **Step 9: Commit**

```bash
git add components/reconciliation/reconciliation-table.tsx "app/(app)/reconciliacao/page.tsx" tests/unit/components/reconciliation-table.test.tsx
git commit -m "feat: add the Reconciliação page (status table with conflict-confirm and undo actions)"
```

---

### Task 10: Docs

**Files:**
- Create: `docs/reconciliation.md`
- Modify: `docs/integrations/olist.md`
- Modify: `docs/assumptions.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Write `docs/reconciliation.md`**

```markdown
# Reconciliação Financeira (Olist × SumUp)

Status: implementada na Fase 4. Ver
`docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md` para a
pesquisa em dados reais e as decisões que fundamentam este documento.

## Por que existe

A WEE não pode somar Olist Orders + Olist Accounts Receivable + SumUp
Transactions diretamente para saber o que efetivamente entrou em caixa —
isso contaria a mesma venda duas vezes (uma pela Olist, outra pela SumUp).
Esta camada vincula cada parcela de conta a receber da Olist paga em cartão
à sua liquidação correspondente na SumUp, para que fases futuras (Fase 5,
motor de fluxo de caixa) tenham uma fonte única e não-duplicada de "isso foi
pago, quando, e por qual valor líquido".

## Como o matching funciona

- Só entram no universo de candidatos as parcelas da Olist cuja
  `forma_recebimento_nome` seja `"Cartão de crédito"` ou `"Cartão de
  débito"` — outras formas de recebimento nunca passam pela SumUp.
- O matching é por **parcela**, não pela venda inteira: o número da parcela
  é extraído do sufixo `/NN` de `numeroDocumento` (`lib/reconciliation/match.ts`,
  `parseInstallmentNumber`) e comparado ao `installment_number` de cada
  `sumup_transaction_events` do tipo `PAYOUT`.
- Comparação é sempre **bruto contra bruto**: o `valor` da parcela Olist
  (já bruto) contra `sumup_transactions.amount / installments_count`
  (estimativa do bruto por parcela da SumUp, arredondada ao centavo) — nunca
  contra o valor líquido do evento SumUp, que já vem descontado da taxa.
- Tolerância: até R$ 0,05 de diferença de valor, ±5 dias entre
  `data_vencimento` (Olist) e `due_date` (SumUp).
- 0 candidatos → `nao_reconciliado`. 1 candidato → `reconciliado_automaticamente`.
  Mais de 1 → `conflito`, resolvido manualmente na tela `/reconciliacao` por
  um `OWNER_ADMIN`/`MANAGER`.

## Quando roda

Automaticamente ao final de todo `runOlistSync`/`runSumupSync` bem-sucedido
(`lib/reconciliation/index.ts`, chamado a partir de
`lib/olist/sync/index.ts` e `lib/sumup/sync/index.ts`) — não há botão manual
separado. Uma falha no motor de reconciliação marca a `sync_runs` inteira
como `failed`, mesmo que a sincronização em si tenha funcionado.

## Idempotência

`reconciliation_matches` tem `unique (org_id, olist_accounts_receivable_id)`
e o motor faz upsert. Uma parcela já resolvida (`reconciliado_automaticamente`
ou `reconciliado_manualmente`) nunca é reprocessada em execuções seguintes —
só parcelas ainda `nao_reconciliado`/`conflito` (ou sem registro algum) são
reavaliadas.

## Fora de escopo desta fase

Ver a seção "Fora de escopo" da spec: motor de taxas históricas (Fase 6),
uso da reconciliação no cálculo de fluxo de caixa (Fase 5), reembolsos, e
reconciliação de contas a pagar.
```

- [ ] **Step 2: Update `docs/integrations/olist.md`**

In the endpoint table, change the "Contas a receber" row to reflect the new detail fetch:

```markdown
| Contas a receber | `GET /contas-receber` (lista) + `GET /contas-receber/{id}` (detalhe, traz taxa/forma de recebimento/data de liquidação — Fase 4) | limit/offset | janela deslizante (sem filtro de data de atualização na API) |
```

Add a bullet to "Edge cases e limitações conhecidas":

```markdown
- **`syncAccountsReceivable` busca o detalhe de toda conta a receber
  listada, não só as pagas em cartão** (Fase 4): a listagem não informa
  `formaRecebimento` antecipadamente, então não há como filtrar antes de
  buscar o detalhe. No volume observado (~625 contas na conta real da WEE)
  isso fica dentro do rate limit já aplicado por `lib/olist/client.ts`; se
  o volume crescer ordens de magnitude, essa chamada N+1 por linha se torna
  o gargalo dominante da sincronização de contas a receber.
```

- [ ] **Step 3: Add a "Riscos conhecidos (Fase 4)" section to `docs/assumptions.md`**

Append after the existing "Riscos conhecidos (Fase 3 — Integração SumUp)" section:

```markdown
## Riscos conhecidos (Fase 4 — Reconciliação)

- **O número da parcela é inferido por regex sobre `numeroDocumento`, não
  por um campo estruturado**: `lib/reconciliation/match.ts`,
  `parseInstallmentNumber`, extrai o sufixo `/NN` de valores como
  `"000516/03"`. Se a Olist mudar esse formato, ou se alguma conta a
  receber legítima tiver um `numeroDocumento` sem esse sufixo por outro
  motivo (não observado nos dados reais inspecionados), a parcela cai em
  `nao_reconciliado` em vez de errar silenciosamente — mas nunca é
  reconciliada até alguém investigar.
- **O motor reprocessa toda conta a receber em cartão ainda não resolvida a
  cada sync bem-sucedido**, não só as alteradas desde a última execução —
  não há uma marca d'água de "já tentei essa parcela e não achei
  candidato". Em volumes pequenos (centenas de parcelas) isso é barato; se
  o volume crescer significativamente, vale revisitar.
- **Nenhuma evidência de produção end-to-end ainda**: assim como as Fases
  2/3 na sua entrega inicial, o motor foi validado com fixtures
  determinísticas, não contra um sync completo real com dados que
  efetivamente casam. Ao depurar um caso real de `conflito` ou
  `nao_reconciliado` inesperado, comece pelos dados reais em
  `olist_accounts_receivable`/`sumup_transaction_events` no Supabase
  Studio antes de assumir um bug no algoritmo.
```

- [ ] **Step 4: Commit**

```bash
git add docs/reconciliation.md docs/integrations/olist.md docs/assumptions.md
git commit -m "docs: document the reconciliation engine and its Fase 4 risks"
```

---

### Task 11: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite one more time end to end**

Run: `npm test`
Expected: all tests pass, no `.only`/`.skip` left behind.

- [ ] **Step 2: Run the linter and the type checker**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Request a Codex review of the diff**

Use the `codex:rescue` skill (or whatever review flow this repo has used at the end of Fases 2/3 — see their plans' final task) against the full branch diff since `master`. Address any findings before the final commit.

- [ ] **Step 4: Manually verify against real data if available**

Same as Task 9 Step 8, but end-to-end: trigger a real Olist sync (which now fetches AR detail) followed by a real SumUp sync, then inspect `reconciliation_matches` in Supabase Studio for plausible results. Document what was and wasn't verified live.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix: address Fase 4 reconciliation review findings"
```

(Only if Step 3/4 produced changes — otherwise this step is a no-op.)

## Acceptance Checklist (from the spec)

- [ ] Sincronização de contas a receber da Olist traz `taxa`, `formaRecebimento`, `dataLiquidacao`, `valorPago` por parcela.
- [ ] O motor de reconciliação roda automaticamente após todo sync Olist/SumUp bem-sucedido.
- [ ] `reconciliation_matches` classifica cada parcela em cartão como `reconciliado_automaticamente`, `nao_reconciliado`, ou `conflito`; nunca escolhe automaticamente entre múltiplos candidatos.
- [ ] Tela `/reconciliacao` lista as parcelas por status; `OWNER_ADMIN`/`MANAGER` podem confirmar candidato de conflito e desfazer match; `VIEWER` só visualiza.
- [ ] Rodar o motor duas vezes não duplica nem perde status manual já resolvido.
- [ ] Nenhum teste automatizado toca a API real da Olist/SumUp.
- [ ] `docs/reconciliation.md` documenta a implementação real.
