# Fase 5 — Motor de Fluxo de Caixa: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CashFlowEngine (realizado/contratado classification, daily/monthly aggregation, saldo confirmado, ajustes manuais) and wire it into the Contas a Receber, Contas a Pagar, Visão Geral, and Fluxo de Caixa (Diário/Mensal/Anual) screens, replacing their current `EmptyState` placeholders.

**Architecture:** Pure classification/aggregation functions (`lib/cash-flow/classify.ts`, `lib/cash-flow/aggregate.ts`, `lib/cash-flow/dates.ts`) tested with deterministic fixtures, wired to an I/O layer (`lib/cash-flow/engine.ts`) that follows the exact `fetchAllPages`/service-role pattern already established in `lib/reconciliation/run.ts`. No new materialized tables for computed results — everything is computed on demand from `olist_accounts_receivable`, `olist_accounts_payable`, `reconciliation_matches`, and two new tables (`cash_balance_snapshots`, `manual_cash_entries`).

**Tech Stack:** Same as the rest of the project — Next.js 16, Supabase/Postgres, TypeScript, Zod, Vitest, plain Tailwind (no new UI/chart dependency — the cash curve is a small hand-rolled inline SVG component).

**Spec:** `docs/superpowers/specs/2026-08-15-fase5-cashflow-design.md`

## Global Constraints

- `saldo` (not the `situacao` text) is the source of truth for realizado/contratado classification on both AR and AP — see spec "Regras de classificação". `situacao` is only used for display and to exclude `cancelado` rows.
- Any `situacao` value outside `{aberto, pago, cancelado}` excludes the row from the cash flow with reason `situacao_desconhecida` — never guessed into a bucket.
- No cash date is ever fabricated: a row with no resolvable date is excluded with reason `dados_incompletos`, not defaulted to "today" or omitted silently.
- AR cash-date priority: reconciled SumUp event `due_date` (when linked via `reconciliation_matches` with a `LINKED_STATUSES` status) → `data_liquidacao` → `data_vencimento`.
- AP cash-date: `data_vencimento` only (Olist doesn't expose an effective payment date in the synced listing — documented limitation, not fabricated).
- All bare SQL `date` arithmetic must go through `lib/cash-flow/dates.ts`'s string-based helpers, never `new Date(dateStr)` + timezone formatting — that pattern silently shifts bare dates by a day (see `lib/reconciliation/run.ts`'s `shiftDateString` comment for the exact failure mode this avoids).
- Writes to `cash_balance_snapshots` and `manual_cash_entries` go through `service_role` from API routes only, gated by `canManageCashBalance` (OWNER_ADMIN only — see Prompt Mestre seção 38), and are recorded in `audit_logs`.
- `manual_cash_entries` is soft-deleted only (`deleted_at`), never hard-deleted, and `cash_balance_snapshots` rows are never updated or deleted — a correction is a new snapshot.
- Follow the existing project conventions throughout: no ORM, hand-written Supabase queries, Zod validation at every API boundary, Portuguese UI copy, `formatBRL`/`formatDateBR` for display formatting only (never for date arithmetic).

---

### Task 1: Migration — `cash_balance_snapshots` and `manual_cash_entries`

**Files:**
- Create: `supabase/migrations/0013_cash_flow.sql`

**Interfaces:**
- Produces: tables `cash_balance_snapshots(id, org_id, reference_date, bank_balance, cash_on_hand, liquid_investments, notes, created_by, created_at)` and `manual_cash_entries(id, org_id, type, description, amount, entry_date, responsible_profile_id, justification, created_by, created_at, updated_at, deleted_at)`.

- [ ] **Step 1: Confirm local Supabase is running**

Run: `npx supabase status`
Expected: shows `API_URL`/`DB_URL` (running). If stopped, run `npx supabase start`.

- [ ] **Step 2: Write the migration**

```sql
-- Fase 5: cash flow engine foundation (Prompt Mestre seções 21-22).
-- See docs/superpowers/specs/2026-08-15-fase5-cashflow-design.md.

create table cash_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  reference_date date not null,
  bank_balance numeric not null,
  cash_on_hand numeric,
  liquid_investments numeric,
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index cash_balance_snapshots_org_id_reference_date_idx
  on cash_balance_snapshots(org_id, reference_date desc);

alter table cash_balance_snapshots enable row level security;
-- No insert/update/delete policy for anon/authenticated on purpose: writes
-- only via service_role from app/api/caixa/saldo/route.ts, which enforces
-- canManageCashBalance (OWNER_ADMIN only) before writing. Snapshots are
-- never updated or deleted — a correction is a new row.

create policy "members can read cash_balance_snapshots in their org" on cash_balance_snapshots
  for select using (is_org_member(org_id));

create table manual_cash_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  type text not null check (type in ('entrada', 'saida', 'ajuste_saldo')),
  description text not null,
  -- entrada/saida amounts are always positive magnitudes (direction comes
  -- from `type`); ajuste_saldo is a signed delta to the confirmed balance
  -- (positive = corrects the balance up, negative = down), so it alone is
  -- exempt from the amount > 0 check.
  amount numeric not null check (type = 'ajuste_saldo' or amount > 0),
  entry_date date not null,
  responsible_profile_id uuid not null references profiles(id),
  justification text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index manual_cash_entries_org_id_entry_date_idx
  on manual_cash_entries(org_id, entry_date);

alter table manual_cash_entries enable row level security;
-- Same pattern: writes only via service_role from
-- app/api/caixa/ajustes/route.ts. Soft-deleted only (deleted_at) — never a
-- hard delete, per Prompt Mestre seção 22 ("nunca apagar silenciosamente").

create policy "members can read manual_cash_entries in their org" on manual_cash_entries
  for select using (is_org_member(org_id));
```

- [ ] **Step 3: Apply and verify locally**

Run: `npx supabase migration up`
Expected: applies cleanly with no errors.

Run:
```sql
select table_name from information_schema.tables
where table_name in ('cash_balance_snapshots', 'manual_cash_entries');
```
(via Supabase Studio SQL editor at the `STUDIO_URL` from `npx supabase status`, or `npx supabase db execute` if available)
Expected: both table names returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_cash_flow.sql
git commit -m "feat: add cash_balance_snapshots and manual_cash_entries tables"
```

---

### Task 2: RBAC — `canManageCashBalance`

**Files:**
- Modify: `lib/auth/rbac.ts`
- Modify: `tests/unit/auth/rbac.test.ts`

**Interfaces:**
- Produces: `canManageCashBalance(role: OrganizationRole): boolean` from `lib/auth/rbac.ts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/auth/rbac.test.ts`, inside the `describe('rbac predicates', ...)` block, and add `canManageCashBalance` to the existing import from `@/lib/auth/rbac`:

```typescript
  it('only OWNER_ADMIN can manage cash balance and manual entries', () => {
    expect(canManageCashBalance('OWNER_ADMIN')).toBe(true)
    expect(canManageCashBalance('MANAGER')).toBe(false)
    expect(canManageCashBalance('VIEWER')).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/auth/rbac.test.ts`
Expected: FAIL — `canManageCashBalance` is not exported.

- [ ] **Step 3: Implement**

Add to `lib/auth/rbac.ts`:

```typescript
export function canManageCashBalance(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/auth/rbac.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/auth/rbac.ts tests/unit/auth/rbac.test.ts
git commit -m "feat: add canManageCashBalance RBAC predicate (OWNER_ADMIN only)"
```

---

### Task 3: Date helpers — `lib/cash-flow/dates.ts`

**Files:**
- Create: `lib/cash-flow/dates.ts`
- Test: `tests/unit/cash-flow/dates.test.ts`

**Interfaces:**
- Produces: `shiftDateString(dateStr: string, days: number): string`, `diffDaysFromToday(dateStr: string, todayStr: string): number` — both pure, operating on bare `YYYY-MM-DD` strings only.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cash-flow/dates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { shiftDateString, diffDaysFromToday } from '@/lib/cash-flow/dates'

describe('shiftDateString', () => {
  it('adds days, rolling over the month boundary', () => {
    expect(shiftDateString('2026-08-30', 3)).toBe('2026-09-02')
  })

  it('subtracts days, rolling under the month boundary', () => {
    expect(shiftDateString('2026-09-02', -3)).toBe('2026-08-30')
  })

  it('is a no-op for zero days', () => {
    expect(shiftDateString('2026-08-15', 0)).toBe('2026-08-15')
  })
})

describe('diffDaysFromToday', () => {
  it('returns a positive number for a future date', () => {
    expect(diffDaysFromToday('2026-08-20', '2026-08-15')).toBe(5)
  })

  it('returns a negative number for a past date', () => {
    expect(diffDaysFromToday('2026-08-10', '2026-08-15')).toBe(-5)
  })

  it('returns zero when the dates are the same', () => {
    expect(diffDaysFromToday('2026-08-15', '2026-08-15')).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/cash-flow/dates.test.ts`
Expected: FAIL — `lib/cash-flow/dates.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/cash-flow/dates.ts`:

```typescript
/**
 * Parses a bare SQL `date` string (YYYY-MM-DD) as a UTC calendar date, so
 * arithmetic never depends on the host machine's timezone. Mirrors the
 * pattern in `lib/reconciliation/run.ts`'s `shiftDateString` — do NOT
 * replace this with `new Date(dateStr)` + a timezone-aware formatter (e.g.
 * `formatDateBR`), which silently shifts a bare date backward by a day when
 * the local timezone is behind UTC (see that file's comment for the exact
 * failure mode).
 */
function toUtcDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function shiftDateString(dateStr: string, days: number): string {
  const date = toUtcDate(dateStr)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Positive when `dateStr` is after `todayStr`, negative when before. */
export function diffDaysFromToday(dateStr: string, todayStr: string): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((toUtcDate(dateStr).getTime() - toUtcDate(todayStr).getTime()) / msPerDay)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cash-flow/dates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/cash-flow/dates.ts tests/unit/cash-flow/dates.test.ts
git commit -m "feat: add string-based date helpers for the cash flow engine"
```

---

### Task 4: Classification rules — `lib/cash-flow/classify.ts` and `lib/cash-flow/aging.ts`

**Files:**
- Create: `lib/cash-flow/classify.ts`
- Create: `lib/cash-flow/aging.ts`
- Test: `tests/unit/cash-flow/classify.test.ts`
- Test: `tests/unit/cash-flow/aging.test.ts`

**Interfaces:**
- Consumes: `diffDaysFromToday` from `lib/cash-flow/dates.ts` (Task 3).
- Produces: `CashBucket`, `ClassifiedEntry`, `classifyAccountsReceivable(ar, reconciledCashDate)`, `classifyAccountsPayable(ap)` from `lib/cash-flow/classify.ts`; `AgingBucket`, `AGING_BUCKET_LABEL`, `computeAgingBucket(cashDate, todayStr)` from `lib/cash-flow/aging.ts`.

- [ ] **Step 1: Write the failing classify tests**

Create `tests/unit/cash-flow/classify.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { classifyAccountsReceivable, classifyAccountsPayable } from '@/lib/cash-flow/classify'

describe('classifyAccountsReceivable', () => {
  const base = {
    valor: 380,
    saldo: 380,
    situacao: 'aberto',
    data_vencimento: '2026-09-01',
    data_liquidacao: null as string | null,
  }

  it('classifies saldo > 0 as contratado, dated by data_vencimento with no other date available', () => {
    const result = classifyAccountsReceivable(base, null)
    expect(result).toEqual({ included: true, bucket: 'contratado', date: '2026-09-01' })
  })

  it('classifies saldo === 0 as realizado', () => {
    const result = classifyAccountsReceivable({ ...base, saldo: 0 }, null)
    expect(result).toEqual({ included: true, bucket: 'realizado', date: '2026-09-01' })
  })

  it('prefers data_liquidacao over data_vencimento when present', () => {
    const result = classifyAccountsReceivable({ ...base, data_liquidacao: '2026-08-28' }, null)
    expect(result).toEqual({ included: true, bucket: 'contratado', date: '2026-08-28' })
  })

  it('prefers the reconciled SumUp cash date over both Olist dates', () => {
    const result = classifyAccountsReceivable({ ...base, data_liquidacao: '2026-08-28' }, '2026-08-25')
    expect(result).toEqual({ included: true, bucket: 'contratado', date: '2026-08-25' })
  })

  it('excludes situacao = cancelado', () => {
    const result = classifyAccountsReceivable({ ...base, situacao: 'cancelado' }, null)
    expect(result).toEqual({ included: false, reason: 'cancelado' })
  })

  it('excludes an unrecognized situacao as situacao_desconhecida, never guessing a bucket', () => {
    const result = classifyAccountsReceivable({ ...base, situacao: 'em_analise' }, null)
    expect(result).toEqual({ included: false, reason: 'situacao_desconhecida' })
  })

  it('excludes a row with no resolvable date as dados_incompletos, never fabricating one', () => {
    const result = classifyAccountsReceivable({ ...base, data_vencimento: null }, null)
    expect(result).toEqual({ included: false, reason: 'dados_incompletos' })
  })

  it('excludes a row with null valor as dados_incompletos', () => {
    const result = classifyAccountsReceivable({ ...base, valor: null }, null)
    expect(result).toEqual({ included: false, reason: 'dados_incompletos' })
  })
})

describe('classifyAccountsPayable', () => {
  const base = {
    valor: 500,
    saldo: 500,
    situacao: 'aberto',
    data_vencimento: '2026-09-01',
  }

  it('classifies saldo > 0 as contratado', () => {
    expect(classifyAccountsPayable(base)).toEqual({ included: true, bucket: 'contratado', date: '2026-09-01' })
  })

  it('classifies saldo === 0 as realizado', () => {
    expect(classifyAccountsPayable({ ...base, saldo: 0 })).toEqual({
      included: true,
      bucket: 'realizado',
      date: '2026-09-01',
    })
  })

  it('excludes situacao = cancelado', () => {
    expect(classifyAccountsPayable({ ...base, situacao: 'cancelado' })).toEqual({
      included: false,
      reason: 'cancelado',
    })
  })

  it('excludes an unrecognized situacao as situacao_desconhecida', () => {
    expect(classifyAccountsPayable({ ...base, situacao: 'protestado' })).toEqual({
      included: false,
      reason: 'situacao_desconhecida',
    })
  })

  it('excludes a row with no data_vencimento as dados_incompletos', () => {
    expect(classifyAccountsPayable({ ...base, data_vencimento: null })).toEqual({
      included: false,
      reason: 'dados_incompletos',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/cash-flow/classify.test.ts`
Expected: FAIL — `lib/cash-flow/classify.ts` doesn't exist yet.

- [ ] **Step 3: Implement classify.ts**

Create `lib/cash-flow/classify.ts`:

```typescript
export type CashBucket = 'realizado' | 'contratado'

export type ClassifiedEntry =
  | { included: true; bucket: CashBucket; date: string }
  | { included: false; reason: 'cancelado' | 'situacao_desconhecida' | 'dados_incompletos' }

/**
 * The only `situacao` values confirmed against the real WEE Olist data as of
 * this phase (see docs/superpowers/specs/2026-08-15-fase5-cashflow-design.md,
 * "Evidência real usada nesta design"): `aberto` and `pago`. `cancelado` is
 * kept per Prompt Mestre seção 8 despite never having been observed — if a
 * different value ever comes back from Olist, it falls into
 * `situacao_desconhecida` below rather than being silently treated as
 * `aberto`.
 */
const KNOWN_SITUACOES = ['aberto', 'pago', 'cancelado']

export type AccountsReceivableInput = {
  valor: number | null
  saldo: number | null
  situacao: string | null
  data_vencimento: string | null
  data_liquidacao: string | null
}

/**
 * `saldo` (not `situacao`) decides realizado vs. contratado — it's the
 * numeric field the Olist keeps consistent with actual payments
 * (`valor_pago = valor - saldo`), so it survives `situacao` text changes.
 *
 * `reconciledCashDate` is the linked SumUp event's `due_date` when this AR
 * row has a resolved reconciliation match (computed by the caller — see
 * `lib/cash-flow/engine.ts`'s `loadReconciledCashDates`); ADR-002 makes it
 * the most precise settlement date available for card installments.
 */
export function classifyAccountsReceivable(
  ar: AccountsReceivableInput,
  reconciledCashDate: string | null
): ClassifiedEntry {
  if (ar.situacao === 'cancelado') return { included: false, reason: 'cancelado' }
  if (!ar.situacao || !KNOWN_SITUACOES.includes(ar.situacao)) {
    return { included: false, reason: 'situacao_desconhecida' }
  }
  if (ar.valor === null || ar.saldo === null) {
    return { included: false, reason: 'dados_incompletos' }
  }

  const date = reconciledCashDate ?? ar.data_liquidacao ?? ar.data_vencimento
  if (!date) return { included: false, reason: 'dados_incompletos' }

  return { included: true, bucket: ar.saldo === 0 ? 'realizado' : 'contratado', date }
}

export type AccountsPayableInput = {
  valor: number | null
  saldo: number | null
  situacao: string | null
  data_vencimento: string | null
}

/**
 * Olist's `/contas-pagar` listing doesn't expose an effective payment date
 * (see docs/integrations/olist.md) — `data_vencimento` is used even for
 * `realizado` (saldo === 0) rows, an approximation documented in the spec's
 * "Riscos e suposições", not a fabricated fact.
 */
export function classifyAccountsPayable(ap: AccountsPayableInput): ClassifiedEntry {
  if (ap.situacao === 'cancelado') return { included: false, reason: 'cancelado' }
  if (!ap.situacao || !KNOWN_SITUACOES.includes(ap.situacao)) {
    return { included: false, reason: 'situacao_desconhecida' }
  }
  if (ap.valor === null || ap.saldo === null || !ap.data_vencimento) {
    return { included: false, reason: 'dados_incompletos' }
  }

  return { included: true, bucket: ap.saldo === 0 ? 'realizado' : 'contratado', date: ap.data_vencimento }
}
```

- [ ] **Step 4: Run classify tests to verify they pass**

Run: `npx vitest run tests/unit/cash-flow/classify.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing aging tests**

Create `tests/unit/cash-flow/aging.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeAgingBucket, AGING_BUCKET_LABEL } from '@/lib/cash-flow/aging'

describe('computeAgingBucket', () => {
  const today = '2026-08-15'

  it('classifies a past date as vencido', () => {
    expect(computeAgingBucket('2026-08-10', today)).toBe('vencido')
  })

  it('classifies today as 0-7', () => {
    expect(computeAgingBucket('2026-08-15', today)).toBe('0-7')
  })

  it('classifies exactly 7 days out as 0-7', () => {
    expect(computeAgingBucket('2026-08-22', today)).toBe('0-7')
  })

  it('classifies 8 days out as 8-15', () => {
    expect(computeAgingBucket('2026-08-23', today)).toBe('8-15')
  })

  it('classifies 16 days out as 16-30', () => {
    expect(computeAgingBucket('2026-08-31', today)).toBe('16-30')
  })

  it('classifies 31 days out as 31-60', () => {
    expect(computeAgingBucket('2026-09-15', today)).toBe('31-60')
  })

  it('classifies 61 days out as 61-90', () => {
    expect(computeAgingBucket('2026-10-15', today)).toBe('61-90')
  })

  it('classifies more than 90 days out as 90+', () => {
    expect(computeAgingBucket('2026-12-15', today)).toBe('90+')
  })
})

describe('AGING_BUCKET_LABEL', () => {
  it('has a Portuguese label for every bucket', () => {
    expect(Object.keys(AGING_BUCKET_LABEL)).toEqual(['vencido', '0-7', '8-15', '16-30', '31-60', '61-90', '90+'])
  })
})
```

- [ ] **Step 6: Run aging tests to verify they fail**

Run: `npx vitest run tests/unit/cash-flow/aging.test.ts`
Expected: FAIL — `lib/cash-flow/aging.ts` doesn't exist yet.

- [ ] **Step 7: Implement aging.ts**

Create `lib/cash-flow/aging.ts`:

```typescript
import { diffDaysFromToday } from '@/lib/cash-flow/dates'

export type AgingBucket = 'vencido' | '0-7' | '8-15' | '16-30' | '31-60' | '61-90' | '90+'

/** Fixed bands per Prompt Mestre seção 10, measured from `todayStr` to `cashDate`. */
export function computeAgingBucket(cashDate: string, todayStr: string): AgingBucket {
  const diff = diffDaysFromToday(cashDate, todayStr)
  if (diff < 0) return 'vencido'
  if (diff <= 7) return '0-7'
  if (diff <= 15) return '8-15'
  if (diff <= 30) return '16-30'
  if (diff <= 60) return '31-60'
  if (diff <= 90) return '61-90'
  return '90+'
}

export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  vencido: 'Vencido',
  '0-7': '0 a 7 dias',
  '8-15': '8 a 15 dias',
  '16-30': '16 a 30 dias',
  '31-60': '31 a 60 dias',
  '61-90': '61 a 90 dias',
  '90+': 'Acima de 90 dias',
}
```

- [ ] **Step 8: Run aging tests to verify they pass**

Run: `npx vitest run tests/unit/cash-flow/aging.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/cash-flow/classify.ts lib/cash-flow/aging.ts tests/unit/cash-flow/classify.test.ts tests/unit/cash-flow/aging.test.ts
git commit -m "feat: add AR/AP cash flow classification and aging bucket rules"
```

---

### Task 5: Engine I/O layer — `lib/cash-flow/engine.ts`

**Files:**
- Modify: `lib/reconciliation/run.ts` (export `fetchAllPages`)
- Create: `lib/cash-flow/engine.ts`
- Test: `tests/unit/cash-flow/engine.test.ts`

**Interfaces:**
- Consumes: `LINKED_STATUSES`, `fetchAllPages` from `lib/reconciliation/run.ts`; `classifyAccountsReceivable`, `classifyAccountsPayable`, `CashBucket` from `lib/cash-flow/classify.ts` (Task 4).
- Produces: `CashFlowEntry` type; `loadCashFlowEntries(orgId): Promise<CashFlowEntry[]>`; `loadReconciledCashDates(admin, orgId): Promise<Map<string, string>>` (exported so Task 10/11's AR/AP pages can reuse it); `resolveOpeningBalance(orgId, date): Promise<{ balance: number; asOf: string } | null>` from `lib/cash-flow/engine.ts`.

- [ ] **Step 1: Export `fetchAllPages` from `lib/reconciliation/run.ts`**

In `lib/reconciliation/run.ts`, change:

```typescript
async function fetchAllPages<T>(
```

to:

```typescript
/** Exported for reuse by lib/cash-flow/engine.ts — same paginated-read need. */
export async function fetchAllPages<T>(
```

Run: `npx vitest run tests/unit/reconciliation/run.test.ts`
Expected: PASS (pure export addition, no behavior change).

- [ ] **Step 2: Write the failing engine tests**

Create `tests/unit/cash-flow/engine.test.ts`. This mirrors the `mockAdmin` pattern in `tests/unit/reconciliation/run.test.ts`: a pageable thenable per table, honoring `.eq`/`.in`/`.not`/`.is`/`.lt`/`.gt`/`.order`/`.limit`/`.range`/`.maybeSingle`.

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'

const ORG_ID = '00000000-0000-0000-0000-000000000001'

type Row = Record<string, unknown>

function makePageableChain(rows: Row[]) {
  let from = 0
  let to = 499
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.not = vi.fn(() => chain)
  chain.is = vi.fn(() => chain)
  chain.range = vi.fn((nextFrom: number, nextTo: number) => {
    from = nextFrom
    to = nextTo
    return chain
  })
  chain.then = (resolve: (value: { data: Row[]; error: null }) => unknown) =>
    resolve({ data: rows.slice(from, to + 1), error: null })
  return chain
}

function mockAdmin(options: {
  arRows?: Row[]
  apRows?: Row[]
  manualRows?: Row[]
  linkedRows?: Row[]
  snapshot?: Row | null
  adjustmentRows?: Row[]
}) {
  const arRows = options.arRows ?? []
  const apRows = options.apRows ?? []
  const manualRows = options.manualRows ?? []
  const linkedRows = options.linkedRows ?? []
  const adjustmentRows = options.adjustmentRows ?? []

  const snapshotChain: Record<string, unknown> = {}
  snapshotChain.eq = vi.fn(() => snapshotChain)
  snapshotChain.lt = vi.fn(() => snapshotChain)
  snapshotChain.order = vi.fn(() => snapshotChain)
  snapshotChain.limit = vi.fn(() => snapshotChain)
  snapshotChain.maybeSingle = vi.fn(() => Promise.resolve({ data: options.snapshot ?? null, error: null }))

  const adjustmentsChain: Record<string, unknown> = {}
  adjustmentsChain.eq = vi.fn(() => adjustmentsChain)
  adjustmentsChain.is = vi.fn(() => adjustmentsChain)
  adjustmentsChain.gt = vi.fn(() => adjustmentsChain)
  adjustmentsChain.lt = vi.fn(() => Promise.resolve({ data: adjustmentRows, error: null }))

  const from = vi.fn((table: string) => {
    if (table === 'olist_accounts_receivable') return { select: vi.fn(() => makePageableChain(arRows)) }
    if (table === 'olist_accounts_payable') return { select: vi.fn(() => makePageableChain(apRows)) }
    if (table === 'manual_cash_entries') return { select: vi.fn(() => makePageableChain(manualRows)) }
    if (table === 'reconciliation_matches') return { select: vi.fn(() => makePageableChain(linkedRows)) }
    if (table === 'cash_balance_snapshots') return { select: vi.fn(() => snapshotChain) }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
}

describe('loadCashFlowEntries', () => {
  afterEach(() => vi.restoreAllMocks())

  it('includes a contratado AR entry and excludes a cancelado AP entry in the same call', async () => {
    mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          saldo: 380,
          situacao: 'aberto',
          data_vencimento: '2026-09-01',
          data_liquidacao: null,
          historico: 'Ref. NF 1',
          numero_documento: '000001/01',
        },
      ],
      apRows: [
        {
          id: 'ap-1',
          valor: 500,
          saldo: 500,
          situacao: 'cancelado',
          data_vencimento: '2026-09-05',
          historico: 'Frete',
          numero_documento: 'F-1',
        },
      ],
    })

    const entries = await loadCashFlowEntries(ORG_ID)

    expect(entries).toEqual([
      {
        id: 'ar-ar-1',
        origin: 'ar',
        sourceId: 'ar-1',
        date: '2026-09-01',
        amount: 380,
        direction: 'entrada',
        bucket: 'contratado',
        description: '000001/01',
      },
    ])
  })

  it('dates a reconciled AR entry by the linked SumUp event due_date, not data_vencimento', async () => {
    mockAdmin({
      arRows: [
        {
          id: 'ar-1',
          valor: 380,
          saldo: 380,
          situacao: 'aberto',
          data_vencimento: '2026-09-01',
          data_liquidacao: null,
          historico: null,
          numero_documento: '000001/01',
        },
      ],
      linkedRows: [
        {
          olist_accounts_receivable_id: 'ar-1',
          sumup_transaction_events: { due_date: '2026-08-28' },
        },
      ],
    })

    const entries = await loadCashFlowEntries(ORG_ID)

    expect(entries[0]).toMatchObject({ date: '2026-08-28', bucket: 'contratado' })
  })

  it('includes a realizado manual entrada/saida and excludes ajuste_saldo from the flat entry list', async () => {
    mockAdmin({
      manualRows: [
        { id: 'm-1', type: 'entrada', amount: 100, entry_date: '2026-08-15', description: 'Venda avulsa' },
      ],
    })

    const entries = await loadCashFlowEntries(ORG_ID)

    expect(entries).toEqual([
      {
        id: 'manual-m-1',
        origin: 'manual',
        sourceId: 'm-1',
        date: '2026-08-15',
        amount: 100,
        direction: 'entrada',
        bucket: 'realizado',
        description: 'Venda avulsa',
      },
    ])
  })
})

describe('resolveOpeningBalance', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns null when there is no snapshot before the given date', async () => {
    mockAdmin({ snapshot: null })
    expect(await resolveOpeningBalance(ORG_ID, '2026-08-15')).toBeNull()
  })

  it('sums bank_balance, cash_on_hand, and liquid_investments from the latest applicable snapshot', async () => {
    mockAdmin({
      snapshot: {
        reference_date: '2026-08-01',
        bank_balance: 10000,
        cash_on_hand: 500,
        liquid_investments: 2000,
      },
      adjustmentRows: [],
    })

    const result = await resolveOpeningBalance(ORG_ID, '2026-08-15')

    expect(result).toEqual({ balance: 12500, asOf: '2026-08-01' })
  })

  it('adds ajuste_saldo entries strictly between the snapshot and the target date', async () => {
    mockAdmin({
      snapshot: { reference_date: '2026-08-01', bank_balance: 10000, cash_on_hand: null, liquid_investments: null },
      adjustmentRows: [{ amount: -300 }, { amount: 50 }],
    })

    const result = await resolveOpeningBalance(ORG_ID, '2026-08-15')

    expect(result).toEqual({ balance: 9750, asOf: '2026-08-01' })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/cash-flow/engine.test.ts`
Expected: FAIL — `lib/cash-flow/engine.ts` doesn't exist yet.

- [ ] **Step 4: Implement**

Create `lib/cash-flow/engine.ts`:

```typescript
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages, LINKED_STATUSES } from '@/lib/reconciliation/run'
import { classifyAccountsReceivable, classifyAccountsPayable, type CashBucket } from '@/lib/cash-flow/classify'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type CashFlowEntry = {
  id: string
  origin: 'ar' | 'ap' | 'manual'
  sourceId: string
  date: string
  amount: number
  direction: 'entrada' | 'saida'
  bucket: CashBucket
  description: string | null
}

type ArRow = {
  id: string
  valor: number | null
  saldo: number | null
  situacao: string | null
  data_vencimento: string | null
  data_liquidacao: string | null
  historico: string | null
  numero_documento: string | null
}

const AR_COLUMNS = 'id, valor, saldo, situacao, data_vencimento, data_liquidacao, historico, numero_documento'

type ReconciledDateRow = {
  olist_accounts_receivable_id: string
  sumup_transaction_events: { due_date: string | null } | null
}

/**
 * Maps `olist_accounts_receivable_id` -> the linked SumUp event's `due_date`
 * for every resolved (`LINKED_STATUSES`) reconciliation match in the org.
 * Exported so the Contas a Receber page (Task 10) can reuse the same lookup
 * for display without duplicating this query.
 */
export async function loadReconciledCashDates(admin: AdminClient, orgId: string): Promise<Map<string, string>> {
  const rows = await fetchAllPages<ReconciledDateRow>(
    (from, to) =>
      admin
        .from('reconciliation_matches')
        .select('olist_accounts_receivable_id, sumup_transaction_events!inner(due_date)')
        .eq('org_id', orgId)
        .in('status', LINKED_STATUSES)
        .not('sumup_transaction_event_id', 'is', null)
        .range(from, to),
    'Failed to load reconciled cash dates'
  )

  const map = new Map<string, string>()
  for (const row of rows as unknown as ReconciledDateRow[]) {
    const dueDate = row.sumup_transaction_events?.due_date
    if (dueDate) map.set(row.olist_accounts_receivable_id, dueDate)
  }
  return map
}

async function loadArEntries(admin: AdminClient, orgId: string): Promise<CashFlowEntry[]> {
  const rows = await fetchAllPages<ArRow>(
    (from, to) => admin.from('olist_accounts_receivable').select(AR_COLUMNS).eq('org_id', orgId).range(from, to),
    'Failed to load olist_accounts_receivable for cash flow'
  )
  const reconciledDates = await loadReconciledCashDates(admin, orgId)

  const entries: CashFlowEntry[] = []
  for (const row of rows) {
    const classified = classifyAccountsReceivable(row, reconciledDates.get(row.id) ?? null)
    if (!classified.included) continue
    entries.push({
      id: `ar-${row.id}`,
      origin: 'ar',
      sourceId: row.id,
      date: classified.date,
      amount: row.valor as number,
      direction: 'entrada',
      bucket: classified.bucket,
      description: row.numero_documento ?? row.historico,
    })
  }
  return entries
}

type ApRow = {
  id: string
  valor: number | null
  saldo: number | null
  situacao: string | null
  data_vencimento: string | null
  historico: string | null
  numero_documento: string | null
}

const AP_COLUMNS = 'id, valor, saldo, situacao, data_vencimento, historico, numero_documento'

async function loadApEntries(admin: AdminClient, orgId: string): Promise<CashFlowEntry[]> {
  const rows = await fetchAllPages<ApRow>(
    (from, to) => admin.from('olist_accounts_payable').select(AP_COLUMNS).eq('org_id', orgId).range(from, to),
    'Failed to load olist_accounts_payable for cash flow'
  )

  const entries: CashFlowEntry[] = []
  for (const row of rows) {
    const classified = classifyAccountsPayable(row)
    if (!classified.included) continue
    entries.push({
      id: `ap-${row.id}`,
      origin: 'ap',
      sourceId: row.id,
      date: classified.date,
      amount: row.valor as number,
      direction: 'saida',
      bucket: classified.bucket,
      description: row.numero_documento ?? row.historico,
    })
  }
  return entries
}

type ManualRow = {
  id: string
  type: 'entrada' | 'saida' | 'ajuste_saldo'
  amount: number
  entry_date: string
  description: string | null
}

async function loadManualEntries(admin: AdminClient, orgId: string): Promise<CashFlowEntry[]> {
  const rows = await fetchAllPages<ManualRow>(
    (from, to) =>
      admin
        .from('manual_cash_entries')
        .select('id, type, amount, entry_date, description')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .in('type', ['entrada', 'saida'])
        .range(from, to),
    'Failed to load manual_cash_entries for cash flow'
  )

  return rows.map((row) => ({
    id: `manual-${row.id}`,
    origin: 'manual' as const,
    sourceId: row.id,
    date: row.entry_date,
    amount: row.amount,
    direction: row.type === 'entrada' ? ('entrada' as const) : ('saida' as const),
    bucket: 'realizado' as const,
    description: row.description,
  }))
}

/**
 * Loads every classified cash flow entry (AR + AP + manual entrada/saida)
 * for the org, as a flat list. `ajuste_saldo` rows are deliberately excluded
 * here — they adjust the confirmed opening balance (`resolveOpeningBalance`
 * below), not the daily entrada/saida flow.
 */
export async function loadCashFlowEntries(orgId: string): Promise<CashFlowEntry[]> {
  const admin = createAdminSupabaseClient()
  const [ar, ap, manual] = await Promise.all([
    loadArEntries(admin, orgId),
    loadApEntries(admin, orgId),
    loadManualEntries(admin, orgId),
  ])
  return [...ar, ...ap, ...manual]
}

/**
 * Resolves the confirmed cash balance to use as the opening balance for
 * `date`: the most recent `cash_balance_snapshots` row strictly before
 * `date`, plus any `ajuste_saldo` manual entries dated strictly between that
 * snapshot and `date`. Returns null when no snapshot exists yet — the
 * caller (`aggregateByDay`) must not fabricate a starting balance.
 */
export async function resolveOpeningBalance(
  orgId: string,
  date: string
): Promise<{ balance: number; asOf: string } | null> {
  const admin = createAdminSupabaseClient()

  const { data: snapshot, error: snapshotError } = await admin
    .from('cash_balance_snapshots')
    .select('reference_date, bank_balance, cash_on_hand, liquid_investments')
    .eq('org_id', orgId)
    .lt('reference_date', date)
    .order('reference_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (snapshotError) {
    throw new Error(`Failed to load cash_balance_snapshots: ${snapshotError.message}`)
  }
  if (!snapshot) return null

  const referenceDate = snapshot.reference_date as string
  const baseBalance =
    (snapshot.bank_balance as number) +
    ((snapshot.cash_on_hand as number | null) ?? 0) +
    ((snapshot.liquid_investments as number | null) ?? 0)

  const { data: adjustments, error: adjustmentsError } = await admin
    .from('manual_cash_entries')
    .select('amount')
    .eq('org_id', orgId)
    .eq('type', 'ajuste_saldo')
    .is('deleted_at', null)
    .gt('entry_date', referenceDate)
    .lt('entry_date', date)

  if (adjustmentsError) {
    throw new Error(`Failed to load ajuste_saldo entries: ${adjustmentsError.message}`)
  }

  const adjustmentTotal = (adjustments ?? []).reduce((sum, row) => sum + (row.amount as number), 0)

  return { balance: baseBalance + adjustmentTotal, asOf: referenceDate }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cash-flow/engine.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/reconciliation/run.ts lib/cash-flow/engine.ts tests/unit/cash-flow/engine.test.ts
git commit -m "feat: add the cash flow engine's I/O layer (entries + opening balance)"
```

---

### Task 6: Aggregation — `lib/cash-flow/aggregate.ts`

**Files:**
- Create: `lib/cash-flow/aggregate.ts`
- Test: `tests/unit/cash-flow/aggregate.test.ts`

**Interfaces:**
- Consumes: `CashFlowEntry` from `lib/cash-flow/engine.ts` (Task 5); `shiftDateString` from `lib/cash-flow/dates.ts` (Task 3).
- Produces: `CashFlowDay`, `aggregateByDay(entries, range, opening)`; `CashFlowMonth`, `aggregateByMonth(days)`; `getMinimumProjectedBalance(days)` from `lib/cash-flow/aggregate.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cash-flow/aggregate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { aggregateByDay, aggregateByMonth, getMinimumProjectedBalance } from '@/lib/cash-flow/aggregate'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'

const entry = (overrides: Partial<CashFlowEntry> = {}): CashFlowEntry => ({
  id: 'e-1',
  origin: 'ar',
  sourceId: 's-1',
  date: '2026-08-15',
  amount: 100,
  direction: 'entrada',
  bucket: 'contratado',
  description: null,
  ...overrides,
})

describe('aggregateByDay', () => {
  it('produces one row per day in the range, even with no entries', () => {
    const days = aggregateByDay([], { from: '2026-08-14', to: '2026-08-16' }, null)
    expect(days.map((d) => d.date)).toEqual(['2026-08-14', '2026-08-15', '2026-08-16'])
  })

  it('has null saldoInicial/saldoFinal for every day when there is no opening balance', () => {
    const days = aggregateByDay([entry()], { from: '2026-08-15', to: '2026-08-15' }, null)
    expect(days[0].saldoInicial).toBeNull()
    expect(days[0].saldoFinal).toBeNull()
  })

  it('buckets entradas and saidas by direction and bucket on the correct day', () => {
    const days = aggregateByDay(
      [
        entry({ date: '2026-08-15', direction: 'entrada', bucket: 'realizado', amount: 50 }),
        entry({ date: '2026-08-15', direction: 'entrada', bucket: 'contratado', amount: 30 }),
        entry({ date: '2026-08-15', direction: 'saida', bucket: 'realizado', amount: 20 }),
        entry({ date: '2026-08-16', direction: 'saida', bucket: 'contratado', amount: 10 }),
      ],
      { from: '2026-08-15', to: '2026-08-16' },
      null
    )
    expect(days[0].entradas).toEqual({ realizado: 50, contratado: 30 })
    expect(days[0].saidas).toEqual({ realizado: 20, contratado: 0 })
    expect(days[1].entradas).toEqual({ realizado: 0, contratado: 0 })
    expect(days[1].saidas).toEqual({ realizado: 0, contratado: 10 })
  })

  it('ignores entries outside the requested range', () => {
    const days = aggregateByDay(
      [entry({ date: '2026-08-01' }), entry({ date: '2026-08-20' })],
      { from: '2026-08-14', to: '2026-08-16' },
      null
    )
    expect(days.every((d) => d.entradas.contratado === 0)).toBe(true)
  })

  it('carries saldoFinal forward as the next day\'s saldoInicial, proving saldoFinal = saldoInicial + entradas - saidas every day', () => {
    const days = aggregateByDay(
      [
        entry({ date: '2026-08-15', direction: 'entrada', bucket: 'realizado', amount: 100 }),
        entry({ date: '2026-08-16', direction: 'saida', bucket: 'realizado', amount: 40 }),
      ],
      { from: '2026-08-15', to: '2026-08-17' },
      { balance: 1000, asOf: '2026-08-14' }
    )
    expect(days[0]).toMatchObject({ saldoInicial: 1000, saldoFinal: 1100 })
    expect(days[1]).toMatchObject({ saldoInicial: 1100, saldoFinal: 1060 })
    expect(days[2]).toMatchObject({ saldoInicial: 1060, saldoFinal: 1060 })
    for (const day of days) {
      expect(day.saldoFinal).toBe(
        (day.saldoInicial as number) + day.entradas.realizado + day.entradas.contratado - day.saidas.realizado - day.saidas.contratado
      )
    }
  })
})

describe('aggregateByMonth', () => {
  it('sums entradas/saidas per month and keeps the last day\'s saldoFinal as the month-end balance', () => {
    const days = aggregateByDay(
      [
        entry({ date: '2026-08-30', direction: 'entrada', bucket: 'realizado', amount: 100 }),
        entry({ date: '2026-09-02', direction: 'saida', bucket: 'realizado', amount: 40 }),
      ],
      { from: '2026-08-30', to: '2026-09-02' },
      { balance: 0, asOf: '2026-08-29' }
    )
    const months = aggregateByMonth(days)
    expect(months).toEqual([
      { month: '2026-08', entradas: { realizado: 100, contratado: 0 }, saidas: { realizado: 0, contratado: 0 }, saldoFinal: 100 },
      { month: '2026-09', entradas: { realizado: 0, contratado: 0 }, saidas: { realizado: 40, contratado: 0 }, saldoFinal: 60 },
    ])
  })
})

describe('getMinimumProjectedBalance', () => {
  it('returns the day with the lowest saldoFinal, ignoring days with a null saldoFinal', () => {
    const days = aggregateByDay(
      [
        entry({ date: '2026-08-16', direction: 'saida', bucket: 'realizado', amount: 500 }),
        entry({ date: '2026-08-17', direction: 'entrada', bucket: 'realizado', amount: 500 }),
      ],
      { from: '2026-08-15', to: '2026-08-17' },
      { balance: 1000, asOf: '2026-08-14' }
    )
    expect(getMinimumProjectedBalance(days)).toEqual({ date: '2026-08-16', balance: 500 })
  })

  it('returns null when every day has a null saldoFinal', () => {
    const days = aggregateByDay([], { from: '2026-08-15', to: '2026-08-15' }, null)
    expect(getMinimumProjectedBalance(days)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/cash-flow/aggregate.test.ts`
Expected: FAIL — `lib/cash-flow/aggregate.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/cash-flow/aggregate.ts`:

```typescript
import type { CashFlowEntry } from '@/lib/cash-flow/engine'
import { shiftDateString } from '@/lib/cash-flow/dates'

export type CashFlowDay = {
  date: string
  saldoInicial: number | null
  entradas: { realizado: number; contratado: number }
  saidas: { realizado: number; contratado: number }
  saldoFinal: number | null
}

/**
 * Aggregates a flat entry list into one row per calendar day in
 * `[range.from, range.to]` (inclusive), threading `saldoFinal` forward as
 * the next day's `saldoInicial`. When `opening` is null (no confirmed
 * balance exists yet — see `resolveOpeningBalance`), every day's
 * saldoInicial/saldoFinal stays null: showing flows without a running
 * balance is acceptable, fabricating one is not (Prompt Mestre seção 51).
 */
export function aggregateByDay(
  entries: CashFlowEntry[],
  range: { from: string; to: string },
  opening: { balance: number; asOf: string } | null
): CashFlowDay[] {
  const byDate = new Map<string, CashFlowEntry[]>()
  for (const entry of entries) {
    if (entry.date < range.from || entry.date > range.to) continue
    const list = byDate.get(entry.date) ?? []
    list.push(entry)
    byDate.set(entry.date, list)
  }

  const days: CashFlowDay[] = []
  let runningBalance = opening?.balance ?? null

  for (let date = range.from; date <= range.to; date = shiftDateString(date, 1)) {
    const dayEntries = byDate.get(date) ?? []
    const entradas = { realizado: 0, contratado: 0 }
    const saidas = { realizado: 0, contratado: 0 }
    for (const entry of dayEntries) {
      const target = entry.direction === 'entrada' ? entradas : saidas
      target[entry.bucket] += entry.amount
    }

    const saldoInicial = runningBalance
    const totalEntradas = entradas.realizado + entradas.contratado
    const totalSaidas = saidas.realizado + saidas.contratado
    const saldoFinal = saldoInicial === null ? null : saldoInicial + totalEntradas - totalSaidas

    days.push({ date, saldoInicial, entradas, saidas, saldoFinal })
    runningBalance = saldoFinal
  }

  return days
}

export type CashFlowMonth = {
  month: string
  entradas: { realizado: number; contratado: number }
  saidas: { realizado: number; contratado: number }
  saldoFinal: number | null
}

/** Folds a chronological `CashFlowDay[]` (as `aggregateByDay` produces) into one row per month. */
export function aggregateByMonth(days: CashFlowDay[]): CashFlowMonth[] {
  const byMonth = new Map<string, CashFlowMonth>()

  for (const day of days) {
    const month = day.date.slice(0, 7)
    const existing = byMonth.get(month) ?? {
      month,
      entradas: { realizado: 0, contratado: 0 },
      saidas: { realizado: 0, contratado: 0 },
      saldoFinal: null,
    }
    existing.entradas.realizado += day.entradas.realizado
    existing.entradas.contratado += day.entradas.contratado
    existing.saidas.realizado += day.saidas.realizado
    existing.saidas.contratado += day.saidas.contratado
    existing.saldoFinal = day.saldoFinal
    byMonth.set(month, existing)
  }

  return Array.from(byMonth.values())
}

/** The lowest saldoFinal across `days`, ignoring days with no confirmed balance yet. */
export function getMinimumProjectedBalance(days: CashFlowDay[]): { date: string; balance: number } | null {
  let min: { date: string; balance: number } | null = null
  for (const day of days) {
    if (day.saldoFinal === null) continue
    if (min === null || day.saldoFinal < min.balance) {
      min = { date: day.date, balance: day.saldoFinal }
    }
  }
  return min
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cash-flow/aggregate.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: all pass (this task only added new files, but confirms nothing else regressed).

- [ ] **Step 6: Commit**

```bash
git add lib/cash-flow/aggregate.ts tests/unit/cash-flow/aggregate.test.ts
git commit -m "feat: add daily/monthly cash flow aggregation and minimum-balance lookup"
```

---

### Task 7: Validation schemas — `lib/validation/cash-flow.ts`

**Files:**
- Create: `lib/validation/cash-flow.ts`
- Test: `tests/unit/validation/cash-flow.test.ts`

**Interfaces:**
- Produces: `cashBalanceSnapshotSchema`, `CashBalanceSnapshotInput`, `manualCashEntrySchema`, `ManualCashEntryInput` from `lib/validation/cash-flow.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/validation/cash-flow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { cashBalanceSnapshotSchema, manualCashEntrySchema } from '@/lib/validation/cash-flow'

describe('cashBalanceSnapshotSchema', () => {
  it('accepts a valid snapshot with optional fields omitted', () => {
    const result = cashBalanceSnapshotSchema.safeParse({ referenceDate: '2026-08-15', bankBalance: 12000 })
    expect(result.success).toBe(true)
  })

  it('rejects a malformed referenceDate', () => {
    const result = cashBalanceSnapshotSchema.safeParse({ referenceDate: '15/08/2026', bankBalance: 12000 })
    expect(result.success).toBe(false)
  })
})

describe('manualCashEntrySchema', () => {
  const base = {
    type: 'entrada' as const,
    description: 'Aporte dos sócios',
    amount: 5000,
    entryDate: '2026-08-15',
    justification: 'Reforço de caixa combinado em reunião',
  }

  it('accepts a valid entrada', () => {
    expect(manualCashEntrySchema.safeParse(base).success).toBe(true)
  })

  it('rejects a non-positive amount for entrada', () => {
    expect(manualCashEntrySchema.safeParse({ ...base, amount: 0 }).success).toBe(false)
    expect(manualCashEntrySchema.safeParse({ ...base, amount: -10 }).success).toBe(false)
  })

  it('accepts a negative amount for ajuste_saldo', () => {
    expect(manualCashEntrySchema.safeParse({ ...base, type: 'ajuste_saldo', amount: -300 }).success).toBe(true)
  })

  it('rejects a zero amount for ajuste_saldo', () => {
    expect(manualCashEntrySchema.safeParse({ ...base, type: 'ajuste_saldo', amount: 0 }).success).toBe(false)
  })

  it('rejects an empty justification', () => {
    expect(manualCashEntrySchema.safeParse({ ...base, justification: '' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/validation/cash-flow.test.ts`
Expected: FAIL — `lib/validation/cash-flow.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/validation/cash-flow.ts`:

```typescript
import { z } from 'zod'

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

export const cashBalanceSnapshotSchema = z.object({
  referenceDate: dateStringSchema,
  bankBalance: z.number(),
  cashOnHand: z.number().nullable().optional(),
  liquidInvestments: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const manualCashEntrySchema = z
  .object({
    type: z.enum(['entrada', 'saida', 'ajuste_saldo']),
    description: z.string().min(1, 'Descrição obrigatória'),
    amount: z.number(),
    entryDate: dateStringSchema,
    justification: z.string().min(1, 'Justificativa obrigatória'),
  })
  .refine((data) => (data.type === 'ajuste_saldo' ? data.amount !== 0 : data.amount > 0), {
    message: 'O valor deve ser positivo para entrada/saída, ou diferente de zero para ajuste de saldo',
    path: ['amount'],
  })

export type CashBalanceSnapshotInput = z.infer<typeof cashBalanceSnapshotSchema>
export type ManualCashEntryInput = z.infer<typeof manualCashEntrySchema>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/validation/cash-flow.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/validation/cash-flow.ts tests/unit/validation/cash-flow.test.ts
git commit -m "feat: add Zod schemas for cash balance snapshots and manual cash entries"
```

---

### Task 8: API route — `POST /api/caixa/saldo`

**Files:**
- Create: `app/api/caixa/saldo/route.ts`
- Test: `tests/unit/cash-flow/saldo-route.test.ts`

**Interfaces:**
- Consumes: `getCurrentMember` from `@/lib/auth/session`; `canManageCashBalance` from `@/lib/auth/rbac` (Task 2); `cashBalanceSnapshotSchema` from `@/lib/validation/cash-flow` (Task 7); `createAdminSupabaseClient` from `@/lib/supabase/admin`.
- Produces: `POST` handler returning `{ ok: true }` on success.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cash-flow/saldo-route.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageCashBalance: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'OWNER_ADMIN' as const }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/caixa/saldo', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function mockAdmin() {
  const snapshotInsertSelect = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: { id: 'snap-1' }, error: null }),
  })
  const snapshotInsert = vi.fn().mockReturnValue({ select: snapshotInsertSelect })
  const auditInsert = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    if (table === 'cash_balance_snapshots') return { insert: snapshotInsert }
    if (table === 'audit_logs') return { insert: auditInsert }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { snapshotInsert, auditInsert }
}

describe('POST /api/caixa/saldo', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/caixa/saldo/route')
    const response = await POST(buildRequest({ referenceDate: '2026-08-15', bankBalance: 1000 }))

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canManageCashBalance', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'MANAGER' } as never)
    vi.mocked(canManageCashBalance).mockReturnValue(false)

    const { POST } = await import('@/app/api/caixa/saldo/route')
    const response = await POST(buildRequest({ referenceDate: '2026-08-15', bankBalance: 1000 }))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageCashBalance).mockReturnValue(true)

    const { POST } = await import('@/app/api/caixa/saldo/route')
    const response = await POST(buildRequest({ referenceDate: 'not-a-date', bankBalance: 1000 }))

    expect(response.status).toBe(400)
  })

  it('inserts a snapshot, an audit log entry, and returns ok on a valid request', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageCashBalance).mockReturnValue(true)
    const { snapshotInsert, auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/caixa/saldo/route')
    const response = await POST(buildRequest({ referenceDate: '2026-08-15', bankBalance: 12000, notes: 'Extrato do dia' }))
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(snapshotInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        reference_date: '2026-08-15',
        bank_balance: 12000,
        notes: 'Extrato do dia',
        created_by: 'profile-1',
      })
    )
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        actor_profile_id: 'profile-1',
        action: 'cash_balance_snapshot_created',
        entity: 'cash_balance_snapshots',
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/cash-flow/saldo-route.test.ts`
Expected: FAIL — `app/api/caixa/saldo/route.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `app/api/caixa/saldo/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { cashBalanceSnapshotSchema } from '@/lib/validation/cash-flow'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canManageCashBalance(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = cashBalanceSnapshotSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const input = parsed.data

  const { data: snapshot, error: insertError } = await admin
    .from('cash_balance_snapshots')
    .insert({
      org_id: member.orgId,
      reference_date: input.referenceDate,
      bank_balance: input.bankBalance,
      cash_on_hand: input.cashOnHand ?? null,
      liquid_investments: input.liquidInvestments ?? null,
      notes: input.notes ?? null,
      created_by: member.profileId,
    })
    .select('id')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'cash_balance_snapshot_created',
    entity: 'cash_balance_snapshots',
    entity_id: snapshot.id,
    after: input,
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cash-flow/saldo-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/caixa/saldo/route.ts tests/unit/cash-flow/saldo-route.test.ts
git commit -m "feat: add POST /api/caixa/saldo to record a confirmed cash balance snapshot"
```

---

### Task 9: API route — `POST /api/caixa/ajustes`

**Files:**
- Create: `app/api/caixa/ajustes/route.ts`
- Test: `tests/unit/cash-flow/ajustes-route.test.ts`

**Interfaces:**
- Consumes: same as Task 8, plus `manualCashEntrySchema` from `@/lib/validation/cash-flow`.
- Produces: `POST` handler returning `{ ok: true }` on success.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cash-flow/ajustes-route.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canManageCashBalance: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'OWNER_ADMIN' as const }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/caixa/ajustes', { method: 'POST', body: JSON.stringify(body) })
}

function mockAdmin() {
  const insertSelect = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data: { id: 'entry-1' }, error: null }),
  })
  const insert = vi.fn().mockReturnValue({ select: insertSelect })
  const auditInsert = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    if (table === 'manual_cash_entries') return { insert }
    if (table === 'audit_logs') return { insert: auditInsert }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { insert, auditInsert }
}

const VALID_BODY = {
  type: 'entrada',
  description: 'Aporte dos sócios',
  amount: 5000,
  entryDate: '2026-08-15',
  justification: 'Reforço de caixa combinado em reunião',
}

describe('POST /api/caixa/ajustes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/caixa/ajustes/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canManageCashBalance', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'MANAGER' } as never)
    vi.mocked(canManageCashBalance).mockReturnValue(false)

    const { POST } = await import('@/app/api/caixa/ajustes/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(403)
  })

  it('returns 400 when amount is not positive for an entrada', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageCashBalance).mockReturnValue(true)

    const { POST } = await import('@/app/api/caixa/ajustes/route')
    const response = await POST(buildRequest({ ...VALID_BODY, amount: 0 }))

    expect(response.status).toBe(400)
  })

  it('inserts a manual entry attributed to the caller, an audit log entry, and returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageCashBalance).mockReturnValue(true)
    const { insert, auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/caixa/ajustes/route')
    const response = await POST(buildRequest(VALID_BODY))
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        type: 'entrada',
        description: 'Aporte dos sócios',
        amount: 5000,
        entry_date: '2026-08-15',
        responsible_profile_id: 'profile-1',
        justification: 'Reforço de caixa combinado em reunião',
        created_by: 'profile-1',
      })
    )
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG_ID,
        actor_profile_id: 'profile-1',
        action: 'manual_cash_entry_created',
        entity: 'manual_cash_entries',
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/cash-flow/ajustes-route.test.ts`
Expected: FAIL — `app/api/caixa/ajustes/route.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `app/api/caixa/ajustes/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { manualCashEntrySchema } from '@/lib/validation/cash-flow'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canManageCashBalance(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = manualCashEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const input = parsed.data

  // The acting user (who must be OWNER_ADMIN — canManageCashBalance) is
  // recorded as the responsible party. There is no UI to attribute a manual
  // entry to a different member in this phase (see plan Task 9 note).
  const { data: created, error: insertError } = await admin
    .from('manual_cash_entries')
    .insert({
      org_id: member.orgId,
      type: input.type,
      description: input.description,
      amount: input.amount,
      entry_date: input.entryDate,
      responsible_profile_id: member.profileId,
      justification: input.justification,
      created_by: member.profileId,
    })
    .select('id')
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'manual_cash_entry_created',
    entity: 'manual_cash_entries',
    entity_id: created.id,
    after: input,
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/cash-flow/ajustes-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/caixa/ajustes/route.ts tests/unit/cash-flow/ajustes-route.test.ts
git commit -m "feat: add POST /api/caixa/ajustes to record a manual cash entry"
```

---

### Task 10: Contas a Receber — table component and page

**Files:**
- Create: `components/cash-flow/accounts-receivable-table.tsx`
- Modify: `app/(app)/contas-a-receber/page.tsx`
- Test: `tests/unit/components/accounts-receivable-table.test.tsx`

**Interfaces:**
- Consumes: `classifyAccountsReceivable`, `ClassifiedEntry` from `@/lib/cash-flow/classify` (Task 4); `computeAgingBucket`, `AGING_BUCKET_LABEL` from `@/lib/cash-flow/aging` (Task 4); `loadReconciledCashDates` from `@/lib/cash-flow/engine` (Task 5); `formatBRL`, `formatDateBR`.
- Produces: `AccountsReceivableRow` type and `AccountsReceivableTable` component from `components/cash-flow/accounts-receivable-table.tsx`.

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/components/accounts-receivable-table.test.tsx`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccountsReceivableTable, type AccountsReceivableRow } from '@/components/cash-flow/accounts-receivable-table'

const BASE_ROW: AccountsReceivableRow = {
  id: 'ar-1',
  numeroDocumento: '000001/01',
  historico: 'Ref. NF 1',
  clienteNome: 'Giovana Dias',
  valor: 380,
  classification: { included: true, bucket: 'contratado', date: '2026-09-01' },
  agingBucket: '16-30',
}

describe('AccountsReceivableTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no rows', () => {
    render(<AccountsReceivableTable rows={[]} today="2026-08-15" />)
    expect(screen.getByText(/Nenhuma conta a receber/)).toBeTruthy()
  })

  it('renders an included row with its formatted value and aging label', () => {
    render(<AccountsReceivableTable rows={[BASE_ROW]} today="2026-08-15" />)
    expect(screen.getByText('000001/01')).toBeTruthy()
    expect(screen.getByText('R$ 380,00')).toBeTruthy()
    expect(screen.getByText('16 a 30 dias')).toBeTruthy()
  })

  it('lists an excluded row under "Fora do fluxo de caixa" with its reason', () => {
    const excludedRow: AccountsReceivableRow = {
      ...BASE_ROW,
      id: 'ar-2',
      classification: { included: false, reason: 'situacao_desconhecida' },
      agingBucket: null,
    }
    render(<AccountsReceivableTable rows={[excludedRow]} today="2026-08-15" />)
    expect(screen.getByText(/Fora do fluxo de caixa/)).toBeTruthy()
    expect(screen.getByText(/situação desconhecida/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/accounts-receivable-table.test.tsx`
Expected: FAIL — `components/cash-flow/accounts-receivable-table.tsx` doesn't exist yet.

- [ ] **Step 3: Implement the component**

Create `components/cash-flow/accounts-receivable-table.tsx`:

```typescript
import { formatBRL } from '@/lib/format/currency'
import { formatDateBR } from '@/lib/format/date'
import type { ClassifiedEntry } from '@/lib/cash-flow/classify'
import { AGING_BUCKET_LABEL, type AgingBucket } from '@/lib/cash-flow/aging'

export type AccountsReceivableRow = {
  id: string
  numeroDocumento: string | null
  historico: string | null
  clienteNome: string | null
  valor: number | null
  classification: ClassifiedEntry
  agingBucket: AgingBucket | null
}

const EXCLUSION_REASON_LABEL: Record<Exclude<ClassifiedEntry, { included: true }>['reason'], string> = {
  cancelado: 'cancelado',
  situacao_desconhecida: 'situação desconhecida',
  dados_incompletos: 'dados incompletos',
}

const BUCKET_LABEL: Record<'realizado' | 'contratado', string> = {
  realizado: 'Realizado',
  contratado: 'Contratado',
}

export function AccountsReceivableTable({ rows, today }: { rows: AccountsReceivableRow[]; today: string }) {
  void today
  const included = rows.filter((row) => row.classification.included)
  const excluded = rows.filter((row) => !row.classification.included)

  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhuma conta a receber encontrada.</p>
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 font-medium">Documento</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Data de caixa</th>
              <th className="px-3 py-2 font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Vencimento em</th>
            </tr>
          </thead>
          <tbody>
            {included.map((row) => {
              const classification = row.classification as { included: true; bucket: 'realizado' | 'contratado'; date: string }
              return (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{row.numeroDocumento ?? row.historico ?? '—'}</td>
                  <td className="px-3 py-2">{row.clienteNome ?? '—'}</td>
                  <td className="px-3 py-2">{formatDateBR(classification.date)}</td>
                  <td className="px-3 py-2">{row.valor != null ? formatBRL(row.valor) : '—'}</td>
                  <td className="px-3 py-2">{BUCKET_LABEL[classification.bucket]}</td>
                  <td className="px-3 py-2">{row.agingBucket ? AGING_BUCKET_LABEL[row.agingBucket] : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {excluded.length > 0 && (
        <details className="rounded-lg border bg-neutral-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-neutral-700">
            Fora do fluxo de caixa ({excluded.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {excluded.map((row) => (
              <li key={row.id} className="text-neutral-600">
                {row.numeroDocumento ?? row.historico ?? row.id} —{' '}
                {EXCLUSION_REASON_LABEL[(row.classification as { included: false; reason: keyof typeof EXCLUSION_REASON_LABEL }).reason]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/accounts-receivable-table.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the page**

Replace `app/(app)/contas-a-receber/page.tsx`:

```typescript
import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { classifyAccountsReceivable } from '@/lib/cash-flow/classify'
import { computeAgingBucket } from '@/lib/cash-flow/aging'
import { loadReconciledCashDates } from '@/lib/cash-flow/engine'
import { toLocalDateParam } from '@/lib/integrations/date'
import { AccountsReceivableTable, type AccountsReceivableRow } from '@/components/cash-flow/accounts-receivable-table'

export default async function ContasAReceberPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver as contas a receber.</p>
  }

  const supabase = await createServerSupabaseClient()
  const { data: arRows, error } = await supabase
    .from('olist_accounts_receivable')
    .select('id, valor, saldo, situacao, data_vencimento, data_liquidacao, historico, numero_documento, cliente_olist_id')
    .order('data_vencimento', { ascending: true })

  if (error) {
    throw new Error(`Falha ao carregar contas a receber: ${error.message}`)
  }

  const { data: contacts } = await supabase.from('olist_contacts').select('olist_id, nome')
  const contactNameByOlistId = new Map((contacts ?? []).map((c) => [c.olist_id as number, c.nome as string | null]))

  const admin = createAdminSupabaseClient()
  const reconciledDates = await loadReconciledCashDates(admin, member.orgId)

  const today = toLocalDateParam(new Date())
  const rows: AccountsReceivableRow[] = (arRows ?? []).map((row) => {
    const classification = classifyAccountsReceivable(row, reconciledDates.get(row.id) ?? null)
    return {
      id: row.id,
      numeroDocumento: row.numero_documento,
      historico: row.historico,
      clienteNome: row.cliente_olist_id ? (contactNameByOlistId.get(row.cliente_olist_id) ?? null) : null,
      valor: row.valor,
      classification,
      agingBucket:
        classification.included && classification.bucket === 'contratado'
          ? computeAgingBucket(classification.date, today)
          : null,
    }
  })

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Contas a Receber</h1>
      <AccountsReceivableTable rows={rows} today={today} />
    </div>
  )
}
```

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add components/cash-flow/accounts-receivable-table.tsx "app/(app)/contas-a-receber/page.tsx" tests/unit/components/accounts-receivable-table.test.tsx
git commit -m "feat: replace the Contas a Receber placeholder with a real listing"
```

---

### Task 11: Contas a Pagar — table component and page

**Files:**
- Create: `components/cash-flow/accounts-payable-table.tsx`
- Modify: `app/(app)/contas-a-pagar/page.tsx`
- Test: `tests/unit/components/accounts-payable-table.test.tsx`

**Interfaces:**
- Consumes: `classifyAccountsPayable`, `ClassifiedEntry` from `@/lib/cash-flow/classify` (Task 4); `computeAgingBucket`, `AGING_BUCKET_LABEL` from `@/lib/cash-flow/aging` (Task 4).
- Produces: `AccountsPayableRow` type and `AccountsPayableTable` component from `components/cash-flow/accounts-payable-table.tsx`.

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/components/accounts-payable-table.test.tsx`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccountsPayableTable, type AccountsPayableRow } from '@/components/cash-flow/accounts-payable-table'

const BASE_ROW: AccountsPayableRow = {
  id: 'ap-1',
  numeroDocumento: 'F-100',
  historico: 'Frete',
  fornecedorNome: 'Transportadora XPTO',
  valor: 500,
  classification: { included: true, bucket: 'contratado', date: '2026-09-01' },
  agingBucket: '16-30',
}

describe('AccountsPayableTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no rows', () => {
    render(<AccountsPayableTable rows={[]} today="2026-08-15" />)
    expect(screen.getByText(/Nenhuma conta a pagar/)).toBeTruthy()
  })

  it('renders an included row with its formatted value and aging label', () => {
    render(<AccountsPayableTable rows={[BASE_ROW]} today="2026-08-15" />)
    expect(screen.getByText('F-100')).toBeTruthy()
    expect(screen.getByText('R$ 500,00')).toBeTruthy()
    expect(screen.getByText('16 a 30 dias')).toBeTruthy()
  })

  it('lists an excluded row under "Fora do fluxo de caixa" with its reason', () => {
    const excludedRow: AccountsPayableRow = {
      ...BASE_ROW,
      id: 'ap-2',
      classification: { included: false, reason: 'cancelado' },
      agingBucket: null,
    }
    render(<AccountsPayableTable rows={[excludedRow]} today="2026-08-15" />)
    expect(screen.getByText(/Fora do fluxo de caixa/)).toBeTruthy()
    expect(screen.getByText(/cancelado/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/accounts-payable-table.test.tsx`
Expected: FAIL — `components/cash-flow/accounts-payable-table.tsx` doesn't exist yet.

- [ ] **Step 3: Implement the component**

Create `components/cash-flow/accounts-payable-table.tsx` — same structure as `AccountsReceivableTable` (Task 10), adapted for AP's fields (no "reconciled SumUp date" concept):

```typescript
import { formatBRL } from '@/lib/format/currency'
import { formatDateBR } from '@/lib/format/date'
import type { ClassifiedEntry } from '@/lib/cash-flow/classify'
import { AGING_BUCKET_LABEL, type AgingBucket } from '@/lib/cash-flow/aging'

export type AccountsPayableRow = {
  id: string
  numeroDocumento: string | null
  historico: string | null
  fornecedorNome: string | null
  valor: number | null
  classification: ClassifiedEntry
  agingBucket: AgingBucket | null
}

const EXCLUSION_REASON_LABEL: Record<Exclude<ClassifiedEntry, { included: true }>['reason'], string> = {
  cancelado: 'cancelado',
  situacao_desconhecida: 'situação desconhecida',
  dados_incompletos: 'dados incompletos',
}

const BUCKET_LABEL: Record<'realizado' | 'contratado', string> = {
  realizado: 'Realizado',
  contratado: 'Contratado',
}

export function AccountsPayableTable({ rows, today }: { rows: AccountsPayableRow[]; today: string }) {
  void today
  const included = rows.filter((row) => row.classification.included)
  const excluded = rows.filter((row) => !row.classification.included)

  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhuma conta a pagar encontrada.</p>
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 font-medium">Documento</th>
              <th className="px-3 py-2 font-medium">Fornecedor</th>
              <th className="px-3 py-2 font-medium">Vencimento</th>
              <th className="px-3 py-2 font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Vencimento em</th>
            </tr>
          </thead>
          <tbody>
            {included.map((row) => {
              const classification = row.classification as { included: true; bucket: 'realizado' | 'contratado'; date: string }
              return (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{row.numeroDocumento ?? row.historico ?? '—'}</td>
                  <td className="px-3 py-2">{row.fornecedorNome ?? '—'}</td>
                  <td className="px-3 py-2">{formatDateBR(classification.date)}</td>
                  <td className="px-3 py-2">{row.valor != null ? formatBRL(row.valor) : '—'}</td>
                  <td className="px-3 py-2">{BUCKET_LABEL[classification.bucket]}</td>
                  <td className="px-3 py-2">{row.agingBucket ? AGING_BUCKET_LABEL[row.agingBucket] : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {excluded.length > 0 && (
        <details className="rounded-lg border bg-neutral-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-neutral-700">
            Fora do fluxo de caixa ({excluded.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {excluded.map((row) => (
              <li key={row.id} className="text-neutral-600">
                {row.numeroDocumento ?? row.historico ?? row.id} —{' '}
                {EXCLUSION_REASON_LABEL[(row.classification as { included: false; reason: keyof typeof EXCLUSION_REASON_LABEL }).reason]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/accounts-payable-table.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the page**

Replace `app/(app)/contas-a-pagar/page.tsx`:

```typescript
import { getCurrentMember } from '@/lib/auth/session'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { classifyAccountsPayable } from '@/lib/cash-flow/classify'
import { computeAgingBucket } from '@/lib/cash-flow/aging'
import { toLocalDateParam } from '@/lib/integrations/date'
import { AccountsPayableTable, type AccountsPayableRow } from '@/components/cash-flow/accounts-payable-table'

export default async function ContasAPagarPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver as contas a pagar.</p>
  }

  const supabase = await createServerSupabaseClient()
  const { data: apRows, error } = await supabase
    .from('olist_accounts_payable')
    .select('id, valor, saldo, situacao, data_vencimento, historico, numero_documento, fornecedor_olist_id')
    .order('data_vencimento', { ascending: true })

  if (error) {
    throw new Error(`Falha ao carregar contas a pagar: ${error.message}`)
  }

  const { data: contacts } = await supabase.from('olist_contacts').select('olist_id, nome')
  const contactNameByOlistId = new Map((contacts ?? []).map((c) => [c.olist_id as number, c.nome as string | null]))

  const today = toLocalDateParam(new Date())
  const rows: AccountsPayableRow[] = (apRows ?? []).map((row) => {
    const classification = classifyAccountsPayable(row)
    return {
      id: row.id,
      numeroDocumento: row.numero_documento,
      historico: row.historico,
      fornecedorNome: row.fornecedor_olist_id ? (contactNameByOlistId.get(row.fornecedor_olist_id) ?? null) : null,
      valor: row.valor,
      classification,
      agingBucket:
        classification.included && classification.bucket === 'contratado'
          ? computeAgingBucket(classification.date, today)
          : null,
    }
  })

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Contas a Pagar</h1>
      <AccountsPayableTable rows={rows} today={today} />
    </div>
  )
}
```

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add components/cash-flow/accounts-payable-table.tsx "app/(app)/contas-a-pagar/page.tsx" tests/unit/components/accounts-payable-table.test.tsx
git commit -m "feat: replace the Contas a Pagar placeholder with a real listing"
```

---

### Task 12: Saldo confirmado and ajustes manuais — forms

**Files:**
- Create: `components/cash-flow/balance-form.tsx`
- Create: `components/cash-flow/manual-entry-form.tsx`
- Test: `tests/unit/components/balance-form.test.tsx`
- Test: `tests/unit/components/manual-entry-form.test.tsx`

**Interfaces:**
- Produces: `BalanceForm` component (posts to `/api/caixa/saldo`); `ManualEntryForm` component (posts to `/api/caixa/ajustes`). Both `'use client'`, both call `router.refresh()` on success. Consumed by Task 15's Visão Geral page.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/balance-form.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { BalanceForm } from '@/components/cash-flow/balance-form'

describe('BalanceForm', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts the entered values to /api/caixa/saldo and shows the error message on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Não autorizado' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BalanceForm />)
    fireEvent.change(screen.getByLabelText('Saldo bancário'), { target: { value: '12000' } })
    fireEvent.change(screen.getByLabelText('Data de referência'), { target: { value: '2026-08-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar saldo' }))

    await waitFor(() => expect(screen.getByText('Não autorizado')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/caixa/saldo',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ referenceDate: '2026-08-15', bankBalance: 12000 }),
      })
    )
  })
})
```

Create `tests/unit/components/manual-entry-form.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ManualEntryForm } from '@/components/cash-flow/manual-entry-form'

describe('ManualEntryForm', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts the entered values to /api/caixa/ajustes and shows the error message on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Descrição obrigatória' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ManualEntryForm />)
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Aporte dos sócios' } })
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText('Justificativa'), { target: { value: 'Reforço de caixa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }))

    await waitFor(() => expect(screen.getByText('Descrição obrigatória')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/caixa/ajustes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'entrada',
          description: 'Aporte dos sócios',
          amount: 5000,
          entryDate: '2026-08-15',
          justification: 'Reforço de caixa',
        }),
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/balance-form.test.tsx tests/unit/components/manual-entry-form.test.tsx`
Expected: FAIL — components don't exist yet.

- [ ] **Step 3: Implement BalanceForm**

Create `components/cash-flow/balance-form.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function BalanceForm() {
  const router = useRouter()
  const [referenceDate, setReferenceDate] = useState('')
  const [bankBalance, setBankBalance] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/caixa/saldo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceDate, bankBalance: Number(bankBalance) }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao registrar saldo')
      } else {
        setReferenceDate('')
        setBankBalance('')
        router.refresh()
      }
    } catch {
      setError('Falha ao registrar saldo')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="balance-reference-date" className="text-xs font-medium text-neutral-600">
          Data de referência
        </label>
        <input
          id="balance-reference-date"
          aria-label="Data de referência"
          type="date"
          required
          value={referenceDate}
          onChange={(e) => setReferenceDate(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="balance-bank-balance" className="text-xs font-medium text-neutral-600">
          Saldo bancário
        </label>
        <input
          id="balance-bank-balance"
          aria-label="Saldo bancário"
          type="number"
          step="0.01"
          required
          value={bankBalance}
          onChange={(e) => setBankBalance(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Registrar saldo
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 4: Implement ManualEntryForm**

Create `components/cash-flow/manual-entry-form.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type EntryType = 'entrada' | 'saida' | 'ajuste_saldo'

export function ManualEntryForm() {
  const router = useRouter()
  const [type, setType] = useState<EntryType>('entrada')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [entryDate, setEntryDate] = useState('')
  const [justification, setJustification] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/caixa/ajustes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, description, amount: Number(amount), entryDate, justification }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao lançar ajuste')
      } else {
        setDescription('')
        setAmount('')
        setEntryDate('')
        setJustification('')
        router.refresh()
      }
    } catch {
      setError('Falha ao lançar ajuste')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-type" className="text-xs font-medium text-neutral-600">
          Tipo
        </label>
        <select
          id="entry-type"
          aria-label="Tipo"
          value={type}
          onChange={(e) => setType(e.target.value as EntryType)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="entrada">Entrada</option>
          <option value="saida">Saída</option>
          <option value="ajuste_saldo">Ajuste de saldo</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-description" className="text-xs font-medium text-neutral-600">
          Descrição
        </label>
        <input
          id="entry-description"
          aria-label="Descrição"
          type="text"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-amount" className="text-xs font-medium text-neutral-600">
          Valor
        </label>
        <input
          id="entry-amount"
          aria-label="Valor"
          type="number"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-date" className="text-xs font-medium text-neutral-600">
          Data
        </label>
        <input
          id="entry-date"
          aria-label="Data"
          type="date"
          required
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-justification" className="text-xs font-medium text-neutral-600">
          Justificativa
        </label>
        <input
          id="entry-justification"
          aria-label="Justificativa"
          type="text"
          required
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Lançar
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/balance-form.test.tsx tests/unit/components/manual-entry-form.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/cash-flow/balance-form.tsx components/cash-flow/manual-entry-form.tsx tests/unit/components/balance-form.test.tsx tests/unit/components/manual-entry-form.test.tsx
git commit -m "feat: add forms to record a confirmed cash balance and manual cash entries"
```

---

### Task 13: Fluxo de Caixa — Diário

**Files:**
- Create: `components/cash-flow/daily-table.tsx`
- Modify: `app/(app)/fluxo-de-caixa/diario/page.tsx`
- Test: `tests/unit/components/daily-table.test.tsx`

**Interfaces:**
- Consumes: `CashFlowDay` from `@/lib/cash-flow/aggregate` (Task 6); `CashFlowEntry` from `@/lib/cash-flow/engine` (Task 5).
- Produces: `DailyTable` component from `components/cash-flow/daily-table.tsx`, expandable per day to show its entries.

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/components/daily-table.test.tsx`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DailyTable } from '@/components/cash-flow/daily-table'
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'

const DAYS: CashFlowDay[] = [
  {
    date: '2026-08-15',
    saldoInicial: 1000,
    entradas: { realizado: 100, contratado: 0 },
    saidas: { realizado: 0, contratado: 0 },
    saldoFinal: 1100,
  },
]

const ENTRIES: CashFlowEntry[] = [
  {
    id: 'manual-1',
    origin: 'manual',
    sourceId: '1',
    date: '2026-08-15',
    amount: 100,
    direction: 'entrada',
    bucket: 'realizado',
    description: 'Venda avulsa',
  },
]

describe('DailyTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no days', () => {
    render(<DailyTable days={[]} entries={[]} />)
    expect(screen.getByText(/Nenhum dado/)).toBeTruthy()
  })

  it('renders a row per day with formatted saldo inicial and final', () => {
    render(<DailyTable days={DAYS} entries={ENTRIES} />)
    expect(screen.getByText('R$ 1.000,00')).toBeTruthy()
    expect(screen.getByText('R$ 1.100,00')).toBeTruthy()
  })

  it('expands a day to show its underlying entries on click', () => {
    render(<DailyTable days={DAYS} entries={ENTRIES} />)
    expect(screen.queryByText('Venda avulsa')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /15\/08\/2026/ }))
    expect(screen.getByText('Venda avulsa')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/daily-table.test.tsx`
Expected: FAIL — `components/cash-flow/daily-table.tsx` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `components/cash-flow/daily-table.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { formatBRL } from '@/lib/format/currency'
import { formatDateBR } from '@/lib/format/date'
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'

export function DailyTable({ days, entries }: { days: CashFlowDay[]; entries: CashFlowEntry[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (days.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum dado de fluxo de caixa neste período.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-medium">Dia</th>
            <th className="px-3 py-2 font-medium">Saldo inicial</th>
            <th className="px-3 py-2 font-medium">Entradas</th>
            <th className="px-3 py-2 font-medium">Saídas</th>
            <th className="px-3 py-2 font-medium">Saldo final</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const dayEntries = entries.filter((entry) => entry.date === day.date)
            const totalEntradas = day.entradas.realizado + day.entradas.contratado
            const totalSaidas = day.saidas.realizado + day.saidas.contratado
            const isExpanded = expanded === day.date
            return (
              <>
                <tr key={day.date} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : day.date)}
                      className="font-medium underline decoration-dotted"
                    >
                      {formatDateBR(day.date)}
                    </button>
                  </td>
                  <td className="px-3 py-2">{day.saldoInicial != null ? formatBRL(day.saldoInicial) : '—'}</td>
                  <td className="px-3 py-2 text-emerald-700">{formatBRL(totalEntradas)}</td>
                  <td className="px-3 py-2 text-red-700">{formatBRL(totalSaidas)}</td>
                  <td className="px-3 py-2 font-medium">{day.saldoFinal != null ? formatBRL(day.saldoFinal) : '—'}</td>
                </tr>
                {isExpanded && (
                  <tr key={`${day.date}-detail`} className="border-b bg-neutral-50 last:border-0">
                    <td colSpan={5} className="px-3 py-2">
                      {dayEntries.length === 0 ? (
                        <p className="text-neutral-500">Nenhum lançamento neste dia.</p>
                      ) : (
                        <ul className="space-y-1">
                          {dayEntries.map((entry) => (
                            <li key={entry.id} className="flex justify-between">
                              <span>
                                {entry.description ?? entry.sourceId} ({entry.origin}, {entry.bucket})
                              </span>
                              <span className={entry.direction === 'entrada' ? 'text-emerald-700' : 'text-red-700'}>
                                {entry.direction === 'entrada' ? '+' : '-'}
                                {formatBRL(entry.amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/daily-table.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the Diário page**

Replace `app/(app)/fluxo-de-caixa/diario/page.tsx`:

```typescript
import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { aggregateByDay } from '@/lib/cash-flow/aggregate'
import { shiftDateString } from '@/lib/cash-flow/dates'
import { toLocalDateParam } from '@/lib/integrations/date'
import { DailyTable } from '@/components/cash-flow/daily-table'

export default async function FluxoDeCaixaDiarioPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o fluxo de caixa.</p>
  }

  const today = toLocalDateParam(new Date())
  const from = shiftDateString(today, -30)
  const to = shiftDateString(today, 90)

  const [entries, opening] = await Promise.all([
    loadCashFlowEntries(member.orgId),
    resolveOpeningBalance(member.orgId, from),
  ])
  const days = aggregateByDay(entries, { from, to }, opening)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fluxo de Caixa — Diário</h1>
      <p className="text-sm text-neutral-500">
        Período: {from} a {to}. Clique em um dia para ver os lançamentos que o compõem.
      </p>
      <DailyTable days={days} entries={entries} />
    </div>
  )
}
```

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add components/cash-flow/daily-table.tsx "app/(app)/fluxo-de-caixa/diario/page.tsx" tests/unit/components/daily-table.test.tsx
git commit -m "feat: replace the Fluxo de Caixa Diário placeholder with the real daily table"
```

---

### Task 14: Fluxo de Caixa — Mensal

**Files:**
- Modify: `app/(app)/fluxo-de-caixa/mensal/page.tsx`

**Interfaces:**
- Consumes: `DailyTable` from `@/components/cash-flow/daily-table` (Task 13); `loadCashFlowEntries`, `resolveOpeningBalance` from `@/lib/cash-flow/engine`; `aggregateByDay` from `@/lib/cash-flow/aggregate`.
- No new component — this page reuses `DailyTable`, scoped to one calendar month picked via a `?mes=YYYY-MM` query param.

- [ ] **Step 1: Implement**

Replace `app/(app)/fluxo-de-caixa/mensal/page.tsx`:

```typescript
import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { aggregateByDay } from '@/lib/cash-flow/aggregate'
import { toLocalDateParam } from '@/lib/integrations/date'
import { DailyTable } from '@/components/cash-flow/daily-table'

function lastDayOfMonth(month: string): string {
  const [year, monthNum] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

export default async function FluxoDeCaixaMensalPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o fluxo de caixa.</p>
  }

  const { mes } = await searchParams
  const month = mes && /^\d{4}-\d{2}$/.test(mes) ? mes : toLocalDateParam(new Date()).slice(0, 7)
  const from = `${month}-01`
  const to = lastDayOfMonth(month)

  const [entries, opening] = await Promise.all([
    loadCashFlowEntries(member.orgId),
    resolveOpeningBalance(member.orgId, from),
  ])
  const days = aggregateByDay(entries, { from, to }, opening)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fluxo de Caixa — Mensal</h1>
      <form className="flex items-center gap-2">
        <label htmlFor="mes" className="text-sm text-neutral-600">
          Mês
        </label>
        <input id="mes" name="mes" type="month" defaultValue={month} className="rounded border px-2 py-1 text-sm" />
        <button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
          Ver
        </button>
      </form>
      <DailyTable days={days} entries={entries} />
    </div>
  )
}
```

- [ ] **Step 2: Run the full unit suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/fluxo-de-caixa/mensal/page.tsx"
git commit -m "feat: replace the Fluxo de Caixa Mensal placeholder with a month-scoped daily table"
```

---

### Task 15: Fluxo de Caixa — Anual

**Files:**
- Create: `components/cash-flow/annual-table.tsx`
- Modify: `app/(app)/fluxo-de-caixa/anual/page.tsx`
- Test: `tests/unit/components/annual-table.test.tsx`

**Interfaces:**
- Consumes: `CashFlowMonth` from `@/lib/cash-flow/aggregate` (Task 6).
- Produces: `AnnualTable` component from `components/cash-flow/annual-table.tsx`.

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/components/annual-table.test.tsx`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AnnualTable } from '@/components/cash-flow/annual-table'
import type { CashFlowMonth } from '@/lib/cash-flow/aggregate'

const MONTHS: CashFlowMonth[] = [
  {
    month: '2026-08',
    entradas: { realizado: 1000, contratado: 500 },
    saidas: { realizado: 300, contratado: 200 },
    saldoFinal: 5000,
  },
]

describe('AnnualTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no months', () => {
    render(<AnnualTable months={[]} />)
    expect(screen.getByText(/Nenhum dado/)).toBeTruthy()
  })

  it('renders a row per month with entradas, saidas, resultado and saldo final totals', () => {
    render(<AnnualTable months={MONTHS} />)
    expect(screen.getByText('R$ 1.500,00')).toBeTruthy() // entradas total
    expect(screen.getByText('R$ 500,00')).toBeTruthy() // saidas total
    expect(screen.getByText('R$ 1.000,00')).toBeTruthy() // resultado (1500 - 500)
    expect(screen.getByText('R$ 5.000,00')).toBeTruthy() // saldo final
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/annual-table.test.tsx`
Expected: FAIL — `components/cash-flow/annual-table.tsx` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `components/cash-flow/annual-table.tsx`:

```typescript
import { formatBRL } from '@/lib/format/currency'
import type { CashFlowMonth } from '@/lib/cash-flow/aggregate'

const MONTH_LABEL = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

function formatMonth(month: string): string {
  const [, monthNum] = month.split('-')
  return MONTH_LABEL[Number(monthNum) - 1] ?? month
}

export function AnnualTable({ months }: { months: CashFlowMonth[] }) {
  if (months.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum dado de fluxo de caixa neste período.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-neutral-50 text-neutral-600">
          <tr>
            <th className="px-3 py-2 font-medium">Mês</th>
            <th className="px-3 py-2 font-medium">Entradas</th>
            <th className="px-3 py-2 font-medium">Saídas</th>
            <th className="px-3 py-2 font-medium">Resultado</th>
            <th className="px-3 py-2 font-medium">Saldo final</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => {
            const totalEntradas = month.entradas.realizado + month.entradas.contratado
            const totalSaidas = month.saidas.realizado + month.saidas.contratado
            const resultado = totalEntradas - totalSaidas
            return (
              <tr key={month.month} className="border-b last:border-0">
                <td className="px-3 py-2">{formatMonth(month.month)}</td>
                <td className="px-3 py-2 text-emerald-700">{formatBRL(totalEntradas)}</td>
                <td className="px-3 py-2 text-red-700">{formatBRL(totalSaidas)}</td>
                <td className={`px-3 py-2 font-medium ${resultado < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {formatBRL(resultado)}
                </td>
                <td className="px-3 py-2 font-medium">{month.saldoFinal != null ? formatBRL(month.saldoFinal) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/annual-table.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the Anual page**

Replace `app/(app)/fluxo-de-caixa/anual/page.tsx`:

```typescript
import { getCurrentMember } from '@/lib/auth/session'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { aggregateByDay, aggregateByMonth } from '@/lib/cash-flow/aggregate'
import { toLocalDateParam } from '@/lib/integrations/date'
import { AnnualTable } from '@/components/cash-flow/annual-table'

export default async function FluxoDeCaixaAnualPage({
  searchParams,
}: {
  searchParams: Promise<{ ano?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o fluxo de caixa.</p>
  }

  const { ano } = await searchParams
  const currentYear = Number(toLocalDateParam(new Date()).slice(0, 4))
  const year = ano && /^\d{4}$/.test(ano) ? Number(ano) : currentYear
  const from = `${year}-01-01`
  const to = `${year}-12-31`

  const [entries, opening] = await Promise.all([
    loadCashFlowEntries(member.orgId),
    resolveOpeningBalance(member.orgId, from),
  ])
  const days = aggregateByDay(entries, { from, to }, opening)
  const months = aggregateByMonth(days)

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fluxo de Caixa — Anual</h1>
      <form className="flex items-center gap-2">
        <label htmlFor="ano" className="text-sm text-neutral-600">
          Ano
        </label>
        <input id="ano" name="ano" type="number" defaultValue={year} className="w-24 rounded border px-2 py-1 text-sm" />
        <button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
          Ver
        </button>
      </form>
      <AnnualTable months={months} />
    </div>
  )
}
```

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add components/cash-flow/annual-table.tsx "app/(app)/fluxo-de-caixa/anual/page.tsx" tests/unit/components/annual-table.test.tsx
git commit -m "feat: replace the Fluxo de Caixa Anual placeholder with the monthly matrix"
```

---

### Task 16: Visão Geral

**Files:**
- Create: `components/cash-flow/cash-curve-chart.tsx`
- Modify: `app/(app)/visao-geral/page.tsx`
- Test: `tests/unit/components/cash-curve-chart.test.tsx`

**Interfaces:**
- Consumes: `CashFlowDay` from `@/lib/cash-flow/aggregate`; `getMinimumProjectedBalance` from `@/lib/cash-flow/aggregate` (Task 6); `BalanceForm`, `ManualEntryForm` from Task 12; `canManageCashBalance` from `@/lib/auth/rbac`.
- Produces: `CashCurveChart` component from `components/cash-flow/cash-curve-chart.tsx` — a small inline-SVG line chart (no new dependency), differentiating realizado from contratado visually.

**Before implementing the chart:** invoke the `dataviz` skill for guidance on color, accessibility, and mark choice before writing the SVG — this repo has no charting library installed and none is being added, so the chart is hand-rolled and must still follow the project's visualization standards (legible in both a light dashboard and printed/screen-shared in a meeting, per Prompt Mestre seção 35).

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/components/cash-curve-chart.test.tsx`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CashCurveChart } from '@/components/cash-flow/cash-curve-chart'
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'

const DAYS: CashFlowDay[] = [
  { date: '2026-08-15', saldoInicial: 1000, entradas: { realizado: 0, contratado: 0 }, saidas: { realizado: 0, contratado: 0 }, saldoFinal: 1000 },
  { date: '2026-08-16', saldoInicial: 1000, entradas: { realizado: 200, contratado: 0 }, saidas: { realizado: 0, contratado: 0 }, saldoFinal: 1200 },
]

describe('CashCurveChart', () => {
  afterEach(() => cleanup())

  it('shows a message when there is no day with a known saldoFinal', () => {
    render(<CashCurveChart days={[{ ...DAYS[0], saldoInicial: null, saldoFinal: null }]} />)
    expect(screen.getByText(/Sem saldo confirmado/)).toBeTruthy()
  })

  it('renders an svg with one point per day that has a known saldoFinal', () => {
    const { container } = render(<CashCurveChart days={DAYS} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(container.querySelectorAll('circle').length).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/cash-curve-chart.test.tsx`
Expected: FAIL — `components/cash-flow/cash-curve-chart.tsx` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `components/cash-flow/cash-curve-chart.tsx` (follow the `dataviz` skill's palette/accessibility guidance from Step 0 when filling in the exact stroke/fill colors — the structure below is fixed, the visual tokens are not):

```typescript
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'

const WIDTH = 640
const HEIGHT = 160
const PADDING = 24

export function CashCurveChart({ days }: { days: CashFlowDay[] }) {
  const known = days.filter((d) => d.saldoFinal !== null) as Array<CashFlowDay & { saldoFinal: number }>

  if (known.length === 0) {
    return <p className="text-sm text-neutral-500">Sem saldo confirmado ainda — registre um saldo para ver a curva.</p>
  }

  const values = known.map((d) => d.saldoFinal)
  const min = Math.min(0, ...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const points = known.map((day, index) => {
    const x = PADDING + (index / Math.max(1, known.length - 1)) * (WIDTH - PADDING * 2)
    const y = HEIGHT - PADDING - ((day.saldoFinal - min) / range) * (HEIGHT - PADDING * 2)
    return { x, y, day }
  })

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const zeroY = HEIGHT - PADDING - ((0 - min) / range) * (HEIGHT - PADDING * 2)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Curva de caixa" className="w-full">
      {min < 0 && (
        <line x1={PADDING} y1={zeroY} x2={WIDTH - PADDING} y2={zeroY} stroke="#dc2626" strokeDasharray="4 4" />
      )}
      <path d={path} fill="none" stroke="#0f172a" strokeWidth={2} />
      {points.map((p) => (
        <circle key={p.day.date} cx={p.x} cy={p.y} r={3} fill={p.day.saldoFinal < 0 ? '#dc2626' : '#0f172a'} />
      ))}
    </svg>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/cash-curve-chart.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the Visão Geral page**

Replace `app/(app)/visao-geral/page.tsx`:

```typescript
import { getCurrentMember } from '@/lib/auth/session'
import { canManageCashBalance } from '@/lib/auth/rbac'
import { loadCashFlowEntries, resolveOpeningBalance } from '@/lib/cash-flow/engine'
import { aggregateByDay, getMinimumProjectedBalance } from '@/lib/cash-flow/aggregate'
import { shiftDateString } from '@/lib/cash-flow/dates'
import { toLocalDateParam } from '@/lib/integrations/date'
import { formatBRL } from '@/lib/format/currency'
import { formatDateBR } from '@/lib/format/date'
import { CashCurveChart } from '@/components/cash-flow/cash-curve-chart'
import { BalanceForm } from '@/components/cash-flow/balance-form'
import { ManualEntryForm } from '@/components/cash-flow/manual-entry-form'

export default async function VisaoGeralPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver a visão geral.</p>
  }

  const today = toLocalDateParam(new Date())
  const from = shiftDateString(today, -90)
  const to = shiftDateString(today, 90)

  const [entries, opening] = await Promise.all([
    loadCashFlowEntries(member.orgId),
    resolveOpeningBalance(member.orgId, from),
  ])
  const days = aggregateByDay(entries, { from, to }, opening)

  const todayIndex = days.findIndex((d) => d.date === today)
  const saldoAtual = todayIndex >= 0 ? days[todayIndex].saldoInicial : null

  const next30 = days.filter((d) => d.date >= today && d.date <= shiftDateString(today, 30))
  const entradas30 = next30.reduce((sum, d) => sum + d.entradas.realizado + d.entradas.contratado, 0)
  const saidas30 = next30.reduce((sum, d) => sum + d.saidas.realizado + d.saidas.contratado, 0)
  const saldoEm30 = next30.length > 0 ? next30[next30.length - 1].saldoFinal : null

  const minimum = getMinimumProjectedBalance(days.filter((d) => d.date >= today))

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Visão Geral</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Saldo de Caixa Atual</p>
          <p className="text-lg font-semibold">{saldoAtual != null ? formatBRL(saldoAtual) : '—'}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Entradas próximos 30 dias</p>
          <p className="text-lg font-semibold text-emerald-700">{formatBRL(entradas30)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Saídas próximos 30 dias</p>
          <p className="text-lg font-semibold text-red-700">{formatBRL(saidas30)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-neutral-500">Saldo projetado em 30 dias</p>
          <p className="text-lg font-semibold">{saldoEm30 != null ? formatBRL(saldoEm30) : '—'}</p>
        </div>
      </div>

      {minimum && minimum.balance < 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Alerta: o saldo projetado fica negativo ({formatBRL(minimum.balance)}) em {formatDateBR(minimum.date)}.
        </div>
      )}

      <div className="rounded-lg border bg-white p-4">
        <p className="mb-2 text-sm font-medium text-neutral-700">Curva de Caixa</p>
        <CashCurveChart days={days} />
      </div>

      {canManageCashBalance(member.role) && (
        <div className="space-y-3">
          <BalanceForm />
          <ManualEntryForm />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Run the full unit suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add components/cash-flow/cash-curve-chart.tsx "app/(app)/visao-geral/page.tsx" tests/unit/components/cash-curve-chart.test.tsx
git commit -m "feat: replace the Visão Geral placeholder with cash flow cards, curve, and alert"
```

---

### Task 17: Integration test, docs, and final verification

**Files:**
- Create: `tests/integration/cash-flow.test.ts`
- Modify: `docs/data-model.md`
- Modify: `docs/financial-rules.md`
- Modify: `docs/decisions.md`
- Modify: `docs/assumptions.md`

**Interfaces:**
- Consumes: `loadCashFlowEntries`, `resolveOpeningBalance` from `@/lib/cash-flow/engine`; `aggregateByDay` from `@/lib/cash-flow/aggregate`. Same real-local-Supabase pattern as `tests/integration/reconciliation.test.ts`.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/cash-flow.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceKey)

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const FIXTURE_PREFIX = 'INTEGRATION-TEST-CASHFLOW'

async function cleanupFixtures(): Promise<void> {
  await admin.from('olist_accounts_receivable').delete().eq('org_id', ORG_ID).like('numero_documento', `${FIXTURE_PREFIX}%`)
  await admin.from('olist_accounts_payable').delete().eq('org_id', ORG_ID).like('numero_documento', `${FIXTURE_PREFIX}%`)
  await admin.from('manual_cash_entries').delete().eq('org_id', ORG_ID).like('description', `${FIXTURE_PREFIX}%`)
  await admin.from('cash_balance_snapshots').delete().eq('org_id', ORG_ID).like('notes', `${FIXTURE_PREFIX}%`)
}

async function seedProfileId(): Promise<string | null> {
  const { data } = await admin.from('organization_members').select('profile_id').eq('org_id', ORG_ID).limit(1).maybeSingle()
  return (data?.profile_id as string | undefined) ?? null
}

describe('cash flow engine — real database integration', () => {
  beforeEach(cleanupFixtures)
  afterEach(cleanupFixtures)

  it('classifies a real AR/AP pair, resolves an opening balance, and aggregates a consistent daily saldo', async () => {
    const profileId = await seedProfileId()
    if (!profileId) {
      // No local profile to attribute a snapshot/entry to on a fresh,
      // unseeded local instance — see the same accepted degradation pattern
      // in tests/integration/reconciliation.test.ts.
      return
    }

    await admin.from('cash_balance_snapshots').insert({
      org_id: ORG_ID,
      reference_date: '2026-08-01',
      bank_balance: 10000,
      notes: `${FIXTURE_PREFIX}-snapshot`,
      created_by: profileId,
    })

    await admin.from('olist_accounts_receivable').insert({
      org_id: ORG_ID,
      olist_id: 999999101,
      situacao: 'aberto',
      data_vencimento: '2026-08-10',
      valor: 500,
      saldo: 500,
      numero_documento: `${FIXTURE_PREFIX}/01`,
      raw: {},
    })

    await admin.from('olist_accounts_payable').insert({
      org_id: ORG_ID,
      olist_id: 999999102,
      situacao: 'aberto',
      data_vencimento: '2026-08-12',
      valor: 200,
      saldo: 200,
      numero_documento: `${FIXTURE_PREFIX}/02`,
      raw: {},
    })

    const { loadCashFlowEntries, resolveOpeningBalance } = await import('@/lib/cash-flow/engine')
    const { aggregateByDay } = await import('@/lib/cash-flow/aggregate')

    const entries = await loadCashFlowEntries(ORG_ID)
    const fixtureEntries = entries.filter((e) => e.sourceId && (e.description ?? '').startsWith(FIXTURE_PREFIX))
    expect(fixtureEntries).toHaveLength(2)

    const opening = await resolveOpeningBalance(ORG_ID, '2026-08-05')
    expect(opening).toEqual({ balance: 10000, asOf: '2026-08-01' })

    const days = aggregateByDay(entries, { from: '2026-08-05', to: '2026-08-15' }, opening)
    for (const day of days) {
      if (day.saldoInicial === null) continue
      expect(day.saldoFinal).toBe(
        day.saldoInicial + day.entradas.realizado + day.entradas.contratado - day.saidas.realizado - day.saidas.contratado
      )
    }
    const arDay = days.find((d) => d.date === '2026-08-10')
    const apDay = days.find((d) => d.date === '2026-08-12')
    expect(arDay?.entradas.contratado).toBeGreaterThanOrEqual(500)
    expect(apDay?.saidas.contratado).toBeGreaterThanOrEqual(200)
  })
})
```

- [ ] **Step 2: Run it against local Supabase**

Ensure local Supabase is running (`npx supabase status`). Run: `npm run test:integration`
Expected: PASS. If it's skipped due to no seeded profile, note that explicitly — same accepted degradation as the Fase 4 integration test.

- [ ] **Step 3: Confirm the rest of the suite is unaffected**

Run: `npm test`
Expected: PASS — `tests/integration/**` must stay excluded from the default config (already true per Fase 4's Task 7 fix to `vitest.config.ts`; verify, don't re-fix unless it regressed).

- [ ] **Step 4: Update `docs/data-model.md`**

Add a section documenting `cash_balance_snapshots` and `manual_cash_entries` (columns, RLS pattern, and that both are write-once/soft-delete-only), matching the style of the existing "Tabelas desta fase" sections in the file.

- [ ] **Step 5: Update `docs/financial-rules.md`**

Replace the "Fase 5: motor de fluxo de caixa" placeholder line with a real section: the realizado/contratado classification rules (saldo-based, not situacao-text-based), the AR cash-date priority (reconciled SumUp date → data_liquidacao → data_vencimento), the AP cash-date approximation (data_vencimento only, documented limitation), the aging bucket bands, and the `saldoFinal = saldoInicial + entradas - saídas` daily rollforward rule — mirror the level of detail already in the spec's "Regras de classificação" section, condensed.

- [ ] **Step 6: Update `docs/decisions.md`**

Add:

```markdown
## ADR-006: `saldo` (não `situacao`) decide realizado vs. contratado
Contexto: o texto de `situacao` retornado pela Olist não é um enum
documentado publicamente, e os únicos valores confirmados em produção são
`aberto`/`pago` — inferir buckets a partir do texto arriscaria classificar
errado se a Olist introduzir uma variação. Decisão: `saldo == 0` decide
`realizado`, `saldo > 0` decide `contratado`, para contas a receber e a
pagar. `situacao` só é usado para exibição e para excluir `cancelado`
(Fase 5).
```

- [ ] **Step 7: Update `docs/assumptions.md`**

Add a new "Riscos conhecidos (Fase 5 — Motor de Fluxo de Caixa)" section documenting: (1) the AP settlement-date approximation (`data_vencimento` used even for `realizado` rows, since Olist's `/contas-pagar` listing doesn't expose an effective payment date); (2) that `situacao = 'cancelado'` has never been observed in real WEE data and the exact string is unconfirmed — an unexpected value falls into `situacao_desconhecida`, not silently into `aberto`; (3) that partial payment (`0 < saldo < valor`) has no real fixture yet, only synthetic unit-test coverage.

- [ ] **Step 8: Run full verification**

```bash
npm test
npm run lint
npx tsc --noEmit
npm run test:integration
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add tests/integration/cash-flow.test.ts docs/data-model.md docs/financial-rules.md docs/decisions.md docs/assumptions.md
git commit -m "test: add a real-database integration test for the cash flow engine; document Fase 5"
```

## Acceptance Checklist

- [ ] `saldo` (not `situacao` text) decides realizado/contratado for both AR and AP; an unrecognized `situacao` never gets silently guessed into a bucket.
- [ ] A card AR installment reconciled to a SumUp event uses that event's `due_date` as its cash date, ahead of `data_liquidacao`/`data_vencimento`.
- [ ] No cash date, payment date, or bank balance is ever fabricated — missing data excludes the row (with a visible reason) or leaves `saldoInicial`/`saldoFinal` null, never a guessed value.
- [ ] `aggregateByDay` proves `saldoFinal = saldoInicial + entradas - saídas` every day, and carries `saldoFinal` forward as the next day's `saldoInicial`.
- [ ] `cash_balance_snapshots` is insert-only; `manual_cash_entries` is soft-delete-only; both are OWNER_ADMIN-only to write, audited via `audit_logs`.
- [ ] Contas a Receber, Contas a Pagar, Visão Geral, and Fluxo de Caixa (Diário/Mensal/Anual) all render real data instead of `EmptyState`.
- [ ] `npm run test:integration` exercises the engine against a live local Postgres and passes (or explicitly notes the no-seeded-profile skip).
- [ ] `npm test`, `npm run lint`, `npx tsc --noEmit` all pass.
