# Fase 4 Follow-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four gaps the Fase 4 final whole-branch review deferred as tracked follow-up: no guard against two AR installments claiming the same SumUp event, an uninformative "Confirmar" button (raw UUID, no amount/date), an "undo" that silently reverts on the next sync, and no real-database integration test.

**Architecture:** Extend `lib/reconciliation/run.ts` with a dedup pass that runs after matching (any SumUp event claimed by more than one resolved match gets demoted to `conflito`, preferring a manual resolution over an automatic one). Enrich `classifyCandidates`'s `conflito` branch to carry each candidate's amount/date so the UI can render something a human can actually decide from. Add a new terminal `rejeitado_manualmente` status so undoing an automatic match doesn't get silently re-created by the next sync. Add a real-database integration test (same pattern as `tests/unit/rls/`) that exercises the engine and the confirm route against a live local Supabase instance.

**Tech Stack:** Same as the rest of the project — Next.js 16, Supabase/Postgres, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-fase4-reconciliacao-design.md` (original Fase 4 spec — this plan extends it, doesn't replace it). The four gaps closed here were raised in the final whole-branch review of the original Fase 4 branch (already merged; see `git log` for the `feat`/`fix` commits from 2026-08-14).

## Global Constraints

- Never lose a `reconciliado_manualmente` resolution to an automatic one: when a dedup conflict involves a manual resolution, the manual one wins regardless of timestamp.
- The new `rejeitado_manualmente` status must be excluded from the matching engine's candidate pool (never re-matched) but must NOT be touched by the FK-repair pass (it has no FK to repair — its FK columns are intentionally null).
- All writes still go through `service_role` with manual `org_id` scoping — no change to that pattern.
- `npm test` must stay real-API-free; the new integration test is a separate suite (its own vitest config + npm script), run against a live **local** Supabase instance only, following the exact pattern already established by `tests/unit/rls/organizations.test.ts` / `vitest.config.rls.ts` / `npm run test:rls`.
- Amount tolerance ≤ R$0,05, date tolerance ±5 days — unchanged, not touched by this plan.

---

### Task 1: Migration — add `rejeitado_manualmente` status

**Files:**
- Create: `supabase/migrations/0012_reconciliation_rejected_status.sql`

**Interfaces:**
- Produces: `reconciliation_matches.status` CHECK constraint now also accepts `'rejeitado_manualmente'`.

- [ ] **Step 1: Find the exact constraint name**

Run against a local Supabase instance (`npx supabase status` to confirm it's running, start it if not):

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'reconciliation_matches'::regclass and contype = 'check';
```

Note the constraint's name (created inline in `supabase/migrations/0011_reconciliation.sql` as `status text not null check (...)` — Postgres auto-names inline column checks `<table>_<column>_check`, so it is very likely `reconciliation_matches_status_check`, but confirm rather than assume).

- [ ] **Step 2: Write the migration**

```sql
-- Fase 4 follow-up: a durable "rejected" terminal state for undoing an
-- automatic match, so it doesn't get silently re-created by the next sync
-- (see docs/reconciliation.md and the Fase 4 final-review ledger).
alter table reconciliation_matches drop constraint reconciliation_matches_status_check;

alter table reconciliation_matches add constraint reconciliation_matches_status_check
  check (status in (
    'reconciliado_automaticamente',
    'reconciliado_manualmente',
    'nao_reconciliado',
    'conflito',
    'rejeitado_manualmente'
  ));
```

Replace `reconciliation_matches_status_check` with whatever Step 1 actually found if it differs.

- [ ] **Step 3: Apply and verify locally**

Run: `npx supabase migration up`
Expected: applies cleanly. Re-run the Step 1 query to confirm the new constraint definition includes `rejeitado_manualmente`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0012_reconciliation_rejected_status.sql
git commit -m "feat: add rejeitado_manualmente as a durable terminal status for reconciliation_matches"
```

---

### Task 2: Consolidate the duplicated card-payment-method list

**Files:**
- Modify: `lib/reconciliation/match.ts`
- Modify: `lib/reconciliation/run.ts`
- Test: `tests/unit/reconciliation/match.test.ts` (add one assertion, no new file)

**Interfaces:**
- Produces: `export const CARD_PAYMENT_METHODS: readonly string[]` from `lib/reconciliation/match.ts`.
- Consumes (in `run.ts`): replaces the locally-duplicated `const CARD_PAYMENT_METHODS = ['Cartão de crédito', 'Cartão de débito']`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/reconciliation/match.test.ts`, inside the existing `describe('isCardPaymentMethod', ...)` block or as a new one:

```typescript
describe('CARD_PAYMENT_METHODS', () => {
  it('is the exact list isCardPaymentMethod checks against', () => {
    expect(CARD_PAYMENT_METHODS).toEqual(['Cartão de crédito', 'Cartão de débito'])
  })
})
```

Add `CARD_PAYMENT_METHODS` to the existing import line at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/reconciliation/match.test.ts`
Expected: FAIL — `CARD_PAYMENT_METHODS` is not exported.

- [ ] **Step 3: Export it and use it in `run.ts`**

In `lib/reconciliation/match.ts`, change:

```typescript
const CARD_PAYMENT_METHODS = ['Cartão de crédito', 'Cartão de débito']
```

to:

```typescript
export const CARD_PAYMENT_METHODS = ['Cartão de crédito', 'Cartão de débito'] as const
```

In `lib/reconciliation/run.ts`, remove the local `const CARD_PAYMENT_METHODS = ['Cartão de crédito', 'Cartão de débito']` and instead import it:

```typescript
import {
  parseInstallmentNumber,
  computeGrossEstimate,
  withinAmountTolerance,
  withinDateWindow,
  classifyCandidates,
  CARD_PAYMENT_METHODS,
  type MatchCandidate,
} from '@/lib/reconciliation/match'
```

`run.ts` uses this in a `.in('forma_recebimento_nome', CARD_PAYMENT_METHODS)` PostgREST call — `readonly string[]` (from `as const`) is assignable there; if `supabase-js`'s types complain, spread it into a mutable array at the call site (`[...CARD_PAYMENT_METHODS]`) rather than dropping `as const` from the export.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/reconciliation/match.test.ts tests/unit/reconciliation/run.test.ts`
Expected: PASS (both files — `run.test.ts` should be unaffected in behavior, just confirm nothing broke)

- [ ] **Step 5: Commit**

```bash
git add lib/reconciliation/match.ts lib/reconciliation/run.ts tests/unit/reconciliation/match.test.ts
git commit -m "refactor: consolidate the duplicated card-payment-method list into a single export"
```

---

### Task 3: Enrich conflict candidates with amount/date for the UI

**Files:**
- Modify: `lib/reconciliation/match.ts`
- Test: `tests/unit/reconciliation/match.test.ts`

**Interfaces:**
- Produces: the `conflito` branch of `MatchResult` now includes a `candidates` array in `matchReason`, shape `{ sumupTransactionEventId: string; valorBrutoSumupEstimado: number; dataVencimentoSumup: string }[]`, in addition to the existing `candidateIds` field (unchanged — `run.ts` and the API routes keep using `candidateIds` for validation; this only adds richer display data inside `matchReason`).

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('classifyCandidates', ...)` block in `tests/unit/reconciliation/match.test.ts`:

```typescript
  it('includes each candidate\'s amount and due date in matchReason for a conflito result', () => {
    const result = classifyCandidates(380, [
      candidate({ sumupTransactionEventId: 'event-1', grossEstimate: 379.98, dueDate: '2026-02-02' }),
      candidate({ sumupTransactionEventId: 'event-2', grossEstimate: 380.02, dueDate: '2026-02-03' }),
    ])
    expect(result.status).toBe('conflito')
    expect(result.status === 'conflito' && result.matchReason.candidatos).toEqual([
      { sumupTransactionEventId: 'event-1', valorBrutoSumupEstimado: 379.98, dataVencimentoSumup: '2026-02-02' },
      { sumupTransactionEventId: 'event-2', valorBrutoSumupEstimado: 380.02, dataVencimentoSumup: '2026-02-03' },
    ])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/reconciliation/match.test.ts`
Expected: FAIL — `matchReason.candidatos` is `undefined`.

- [ ] **Step 3: Implement**

In `lib/reconciliation/match.ts`, change the `conflito` return in `classifyCandidates`:

```typescript
  return {
    status: 'conflito',
    candidateIds: candidates.map((candidate) => candidate.sumupTransactionEventId),
    matchReason: {
      motivo: 'multiplos_candidatos',
      candidatosAvaliados: candidates.length,
      candidatos: candidates.map((candidate) => ({
        sumupTransactionEventId: candidate.sumupTransactionEventId,
        valorBrutoSumupEstimado: candidate.grossEstimate,
        dataVencimentoSumup: candidate.dueDate,
      })),
    },
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/reconciliation/match.test.ts tests/unit/reconciliation/run.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/reconciliation/match.ts tests/unit/reconciliation/match.test.ts
git commit -m "feat: include each conflict candidate's amount and due date in match_reason"
```

---

### Task 4: Duplicate-event-claim guard

**Files:**
- Modify: `lib/reconciliation/run.ts`
- Modify: `tests/unit/reconciliation/run.test.ts`

**Interfaces:**
- Produces: `runReconciliation` now also demotes any `reconciliation_matches` row that shares its `sumup_transaction_event_id` with another resolved row, after the main matching loop and the FK-repair pass.
- Consumes: reuses the existing `fetchAllPages` helper and `AdminClient` type already in `run.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/reconciliation/run.test.ts`. First, extend the `mockAdmin` helper (or add a dedicated one — follow whatever pattern the existing helper already uses for `reconciliation_matches` in this file, extending it to support a `select` chain that returns `id, olist_accounts_receivable_id, sumup_transaction_event_id, status, created_at` filtered by `.in('status', [...])` and `.not('sumup_transaction_event_id', 'is', null)`, paginated via `.range()`) so these new tests can control what the dedup pass's read returns and assert on its `update` calls. Read the current mock structure in this file before writing — it already has page-aware mocking for the resolved-ids read and the AR-candidates read (Task added by the earlier Fase 4 fix wave); mirror that shape for a third mocked read.

```typescript
describe('runReconciliation — duplicate event claim guard', () => {
  it('demotes the newer of two auto-matched rows claiming the same SumUp event to conflito', async () => {
    // Arrange: no unresolved AR rows for the main loop (empty), so this test
    // exercises only the dedup pass. Two existing resolved rows share
    // sumup_transaction_event_id = 'event-shared': row 'match-old' (created
    // first, status reconciliado_automaticamente) and row 'match-new'
    // (created later, same status, same event).
    // ... set up the mock so the dedup-pass read returns both rows ...

    // Act
    await runReconciliation(ORG_ID)

    // Assert: an update was issued for 'match-new' (the later-created row)
    // setting status: 'conflito', sumup_transaction_id: null,
    // sumup_transaction_event_id: null, resolved_by: null, resolved_at: null,
    // and match_reason.motivo === 'evento_sumup_reivindicado_por_outra_parcela'.
    // No update was issued for 'match-old'.
  })

  it('keeps a reconciliado_manualmente row over a reconciliado_automaticamente row claiming the same event, regardless of creation order', async () => {
    // Same shared event, but the manually-resolved row was created AFTER the
    // automatic one. The manual row must still win — assert the automatic
    // row gets demoted, not the manual one.
  })

  it('does not touch rows whose sumup_transaction_event_id is unique among resolved rows', async () => {
    // Two resolved rows with different event ids — assert no update calls
    // from the dedup pass.
  })
})
```

Write out the actual mock setup and assertions in full — the sketch above describes the three required cases; implement them with real mock data (an `ORG_ID` constant and helper builders already exist earlier in this file, reuse them) and real `expect` calls, not placeholder comments.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/reconciliation/run.test.ts`
Expected: FAIL — no dedup pass exists yet.

- [ ] **Step 3: Implement the dedup pass**

In `lib/reconciliation/run.ts`, add a constant for the statuses eligible for dedup/repair (both hold a real FK), distinct from the status list used to *exclude* rows from the main matching loop:

```typescript
// Statuses that hold (or should hold) a real SumUp FK — eligible for the
// FK-repair pass and the duplicate-event-claim guard. Does NOT include
// 'rejeitado_manualmente': a rejected row's FK is intentionally null and
// must never be repaired or considered a claim.
const LINKED_STATUSES = ['reconciliado_automaticamente', 'reconciliado_manualmente']

// Statuses that must never re-enter the matching engine's candidate pool —
// broader than LINKED_STATUSES because it also covers the durable "no"
// (rejeitado_manualmente).
const RESOLVED_STATUSES = ['reconciliado_automaticamente', 'reconciliado_manualmente', 'rejeitado_manualmente']
```

Update every existing use of `RESOLVED_STATUSES` in the file: the main loop's resolved-ids exclusion query should use the new (broader) `RESOLVED_STATUSES`; `repairStrandedMatches`'s query should use `LINKED_STATUSES` instead (a rejected row must never be "repaired" back into existence). Read the current file first to find both call sites precisely before editing.

Add the dedup pass, called at the end of `runReconciliation` after `repairStrandedMatches`:

```typescript
/**
 * Two AR installments can end up claiming the same SumUp event across
 * separate runs (e.g. a repair-pass re-link happens to pick the same event
 * another row already holds). This is exactly the double-count the phase
 * exists to prevent, so after every run, any event claimed by more than one
 * `LINKED_STATUSES` row gets down to one legitimate claimant: prefer a
 * manual resolution over an automatic one (a human decision outranks the
 * engine's guess); among a tie, the earliest-created row wins. Every other
 * claimant in the group is demoted to `conflito`, cleared of its FK and
 * resolution fields, so a human can review it.
 */
async function guardAgainstDuplicateEventClaims(admin: AdminClient, orgId: string): Promise<void> {
  const linkedRows = await fetchAllPages<{
    id: string
    sumup_transaction_event_id: string
    status: string
    created_at: string
  }>(
    (from, to) =>
      admin
        .from('reconciliation_matches')
        .select('id, sumup_transaction_event_id, status, created_at')
        .eq('org_id', orgId)
        .in('status', LINKED_STATUSES)
        .not('sumup_transaction_event_id', 'is', null)
        .range(from, to),
    'Failed to load linked reconciliation_matches for duplicate-claim check'
  )

  const byEvent = new Map<string, typeof linkedRows>()
  for (const row of linkedRows) {
    const group = byEvent.get(row.sumup_transaction_event_id) ?? []
    group.push(row)
    byEvent.set(row.sumup_transaction_event_id, group)
  }

  for (const group of byEvent.values()) {
    if (group.length < 2) continue

    const manual = group.filter((row) => row.status === 'reconciliado_manualmente')
    const contenders = manual.length > 0 ? manual : group
    const winner = contenders.reduce((earliest, row) =>
      row.created_at < earliest.created_at ? row : earliest
    )

    for (const row of group) {
      if (row.id === winner.id) continue

      const { error } = await admin
        .from('reconciliation_matches')
        .update({
          status: 'conflito',
          sumup_transaction_id: null,
          sumup_transaction_event_id: null,
          resolved_by: null,
          resolved_at: null,
          match_reason: { motivo: 'evento_sumup_reivindicado_por_outra_parcela' },
          candidate_ids: [row.sumup_transaction_event_id],
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)

      if (error) {
        throw new Error(`Failed to demote duplicate-claim reconciliation_matches ${row.id}: ${error.message}`)
      }
    }
  }
}
```

Call it at the end of `runReconciliation`:

```typescript
  await repairStrandedMatches(admin, orgId)
  await guardAgainstDuplicateEventClaims(admin, orgId)

  return { processed }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/reconciliation/run.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass (this task touched shared constants used elsewhere in the file — confirm nothing else regressed)

- [ ] **Step 6: Commit**

```bash
git add lib/reconciliation/run.ts tests/unit/reconciliation/run.test.ts
git commit -m "feat: demote duplicate SumUp-event claims across reconciliation_matches to conflito"
```

---

### Task 5: Durable rejection on undoing an automatic match

**Files:**
- Modify: `app/api/reconciliacao/[id]/desfazer/route.ts`
- Modify: `tests/unit/reconciliation/desfazer-route.test.ts`

**Interfaces:**
- Consumes: `'rejeitado_manualmente'` status added by Task 1's migration.
- Produces: undoing a `reconciliado_automaticamente` match now sets its status to `'rejeitado_manualmente'` (not `'nao_reconciliado'`) and records `resolved_by`/`resolved_at` for the rejection. Undoing a `reconciliado_manualmente` match is unchanged (resets to `'nao_reconciliado'`, matching the existing spec: a human overturning another human's conflict resolution should go back to needing a fresh decision, not become a permanent rejection).

- [ ] **Step 1: Write the failing tests**

Read the current `app/api/reconciliacao/[id]/desfazer/route.ts` and `tests/unit/reconciliation/desfazer-route.test.ts` first — this task modifies existing logic, not greenfield code. Add two tests to the existing test file (alongside the current "resets the match to nao_reconciliado" test, which covers the *manual*-undo path and should be renamed/scoped if it doesn't already specify which starting status it uses — check):

```typescript
  it('rejects (rejeitado_manualmente) when undoing a reconciliado_automaticamente match, recording who rejected it', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    const { update } = mockAdmin({ match: { id: MATCH_ID, status: 'reconciliado_automaticamente' } })

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    const response = await POST(buildRequest(), ctx())
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejeitado_manualmente',
        sumup_transaction_event_id: null,
        sumup_transaction_id: null,
        resolved_by: 'profile-1',
      })
    )
  })

  it('resets to nao_reconciliado (not rejeitado_manualmente) when undoing a reconciliado_manualmente match', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canManageReconciliation).mockReturnValue(true)
    const { update } = mockAdmin({ match: { id: MATCH_ID, status: 'reconciliado_manualmente' } })

    const { POST } = await import('@/app/api/reconciliacao/[id]/desfazer/route')
    await POST(buildRequest(), ctx())

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'nao_reconciliado', resolved_by: null })
    )
  })
```

This requires the route's existing `select` on `reconciliation_matches` to fetch `status` in addition to `id` (currently it likely only selects `id` — check), and the test's `mockAdmin` helper to accept a `status` field on the mocked `match` object and return it from the `select`'s `maybeSingle()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/reconciliation/desfazer-route.test.ts`
Expected: FAIL — route currently always resets to `nao_reconciliado` regardless of prior status.

- [ ] **Step 3: Implement**

In `app/api/reconciliacao/[id]/desfazer/route.ts`, change the `select` to also fetch `status`:

```typescript
  const { data: match, error: matchError } = await admin
    .from('reconciliation_matches')
    .select('id, status')
    .eq('id', id)
    .eq('org_id', member.orgId)
    .maybeSingle()
```

Then branch the update on the match's prior status:

```typescript
  const wasAutomatic = match.status === 'reconciliado_automaticamente'

  const { error: updateError } = await admin
    .from('reconciliation_matches')
    .update({
      status: wasAutomatic ? 'rejeitado_manualmente' : 'nao_reconciliado',
      sumup_transaction_event_id: null,
      sumup_transaction_id: null,
      resolved_by: wasAutomatic ? member.profileId : null,
      resolved_at: wasAutomatic ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', member.orgId)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/reconciliation/desfazer-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/reconciliacao/\[id\]/desfazer/route.ts tests/unit/reconciliation/desfazer-route.test.ts
git commit -m "feat: undoing an automatic match now rejects it durably instead of letting the next sync silently redo it"
```

---

### Task 6: UI — show candidate amount/date, label the rejected status

**Files:**
- Modify: `components/reconciliation/reconciliation-table.tsx`
- Modify: `app/(app)/reconciliacao/page.tsx`
- Modify: `tests/unit/components/reconciliation-table.test.tsx`

**Interfaces:**
- Consumes: `matchReason.candidatos` from Task 3, `'rejeitado_manualmente'` status from Task 1.
- Produces: `MatchRow` gains a `match_reason: { candidatos?: Array<{ sumupTransactionEventId: string; valorBrutoSumupEstimado: number; dataVencimentoSumup: string }> } | null` field; `MatchStatus` gains `'rejeitado_manualmente'`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/components/reconciliation-table.test.tsx`:

```typescript
  it('shows each candidate\'s amount and date on its Confirmar button when match_reason has candidate details', () => {
    render(
      <ReconciliationTable
        matches={[
          {
            ...BASE_MATCH,
            status: 'conflito',
            candidate_ids: ['event-1'],
            match_reason: {
              candidatos: [
                { sumupTransactionEventId: 'event-1', valorBrutoSumupEstimado: 379.98, dataVencimentoSumup: '2026-02-02' },
              ],
            },
          },
        ]}
        canManage={true}
      />
    )
    expect(screen.getByRole('button', { name: /R\$ 379,98/ })).toBeTruthy()
  })

  it('falls back to a truncated id when match_reason has no candidate details', () => {
    render(
      <ReconciliationTable
        matches={[{ ...BASE_MATCH, status: 'conflito', candidate_ids: ['event-12345678'], match_reason: null }]}
        canManage={true}
      />
    )
    expect(screen.getByRole('button', { name: /event-12/ })).toBeTruthy()
  })

  it('labels a rejeitado_manualmente match and shows no action buttons for it', () => {
    render(<ReconciliationTable matches={[{ ...BASE_MATCH, status: 'rejeitado_manualmente' }]} canManage={true} />)
    expect(screen.getByText('Rejeitado manualmente')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
```

`BASE_MATCH` in this file will need a `match_reason: null` field added to stay a valid `MatchRow` once the type changes — update its definition too.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/reconciliation-table.test.tsx`
Expected: FAIL — `match_reason` prop doesn't exist yet, `rejeitado_manualmente` isn't a valid status, no candidate-detail rendering.

- [ ] **Step 3: Implement**

In `components/reconciliation/reconciliation-table.tsx`:

```typescript
export type MatchStatus =
  | 'reconciliado_automaticamente'
  | 'reconciliado_manualmente'
  | 'nao_reconciliado'
  | 'conflito'
  | 'rejeitado_manualmente'

type MatchReasonCandidate = {
  sumupTransactionEventId: string
  valorBrutoSumupEstimado: number
  dataVencimentoSumup: string
}

export type MatchRow = {
  id: string
  status: MatchStatus
  candidate_ids: string[]
  match_reason: { candidatos?: MatchReasonCandidate[] } | null
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
  rejeitado_manualmente: 'Rejeitado manualmente',
}
```

`RESOLVED_STATUSES` (the array gating the "Desfazer" button) stays `['reconciliado_automaticamente', 'reconciliado_manualmente']` unchanged — `rejeitado_manualmente` is terminal and gets no action buttons at all, so it must NOT be added there.

Add a helper to look up a candidate's display detail, and use it in the button label:

```typescript
function candidateLabel(candidateId: string, matchReason: MatchRow['match_reason']): string {
  const detail = matchReason?.candidatos?.find((c) => c.sumupTransactionEventId === candidateId)
  if (!detail) return candidateId.slice(0, 8)
  return `${formatBRL(detail.valorBrutoSumupEstimado)} · ${formatDateBR(detail.dataVencimentoSumup)}`
}
```

Change the button's text from `Confirmar {candidateId.slice(0, 8)}` to `` Confirmar {candidateLabel(candidateId, match.match_reason)} ``.

- [ ] **Step 4: Update the page query**

In `app/(app)/reconciliacao/page.tsx`, add `match_reason` to the `.select(...)` string so it reaches the component (check the current select string and insert it alongside the existing columns, e.g. `id, status, candidate_ids, match_reason, olist_accounts_receivable:...`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/components/reconciliation-table.test.tsx`
Expected: PASS

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add components/reconciliation/reconciliation-table.tsx "app/(app)/reconciliacao/page.tsx" tests/unit/components/reconciliation-table.test.tsx
git commit -m "feat: show each conflict candidate's amount/date instead of a raw id, and label the rejected status"
```

---

### Task 7: Real-database integration test

**Files:**
- Create: `vitest.config.integration.ts`
- Create: `tests/integration/reconciliation.test.ts`
- Modify: `package.json` (new script)

**Interfaces:**
- Consumes: `runReconciliation` from `@/lib/reconciliation`; the `POST` handler from `@/app/api/reconciliacao/[id]/confirmar/route`; a real local Supabase instance via `SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` from `.env.local` (same env vars `tests/unit/rls/organizations.test.ts` already uses).

- [ ] **Step 1: Create the integration vitest config**

Copy the shape of `vitest.config.rls.ts` exactly, changing only the `include` pattern:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '.env.local') })

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add alongside the existing `"test:rls"` line:

```json
    "test:integration": "vitest run --config vitest.config.integration.ts",
```

- [ ] **Step 3: Write the integration test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceKey)

// Fixed local seed org — see supabase/seed.sql.
const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: null as string | null, role: 'OWNER_ADMIN' as const }

// Every fixture row this file creates carries this prefix in
// numero_documento, so cleanup can find them precisely without touching
// any other data a developer might have in their local instance.
const FIXTURE_PREFIX = 'INTEGRATION-TEST-RECONCILIACAO'

async function cleanupFixtures(): Promise<void> {
  const { data: arRows } = await admin
    .from('olist_accounts_receivable')
    .select('id')
    .eq('org_id', ORG_ID)
    .like('numero_documento', `${FIXTURE_PREFIX}%`)

  const arIds = (arRows ?? []).map((row) => row.id)
  if (arIds.length > 0) {
    await admin.from('reconciliation_matches').delete().in('olist_accounts_receivable_id', arIds)
    await admin.from('olist_accounts_receivable').delete().in('id', arIds)
  }

  const { data: txRows } = await admin
    .from('sumup_transactions')
    .select('id')
    .eq('org_id', ORG_ID)
    .like('transaction_code', `${FIXTURE_PREFIX}%`)

  const txIds = (txRows ?? []).map((row) => row.id)
  if (txIds.length > 0) {
    await admin.from('sumup_transaction_events').delete().in('transaction_id', txIds)
    await admin.from('sumup_transactions').delete().in('id', txIds)
  }
}

async function seedMember(): Promise<void> {
  // Reuse a real profile if one exists locally (e.g. from `supabase db reset`
  // + manual signup); otherwise these tests need a profile row to satisfy
  // reconciliation_matches.resolved_by's FK when the confirm route runs. Look
  // one up rather than creating an auth user here (out of scope for this
  // test — auth user creation is already covered by tests/unit/rls/).
  const { data } = await admin.from('organization_members').select('profile_id').eq('org_id', ORG_ID).limit(1).maybeSingle()
  MEMBER.profileId = (data?.profile_id as string | undefined) ?? null
}

describe('reconciliation engine — real database integration', () => {
  beforeEach(async () => {
    await cleanupFixtures()
    await seedMember()
  })

  afterEach(async () => {
    await cleanupFixtures()
  })

  it('matches a card-paid installment against a SumUp PAYOUT event end-to-end, is idempotent, and survives a confirm', async () => {
    const { data: tx, error: txError } = await admin
      .from('sumup_transactions')
      .insert({
        org_id: ORG_ID,
        transaction_code: `${FIXTURE_PREFIX}-tx-1`,
        amount: 809.2,
        currency: 'BRL',
        status: 'SUCCESSFUL',
        installments_count: 1,
        raw: {},
      })
      .select('id')
      .single()
    if (txError || !tx) throw new Error(`fixture setup failed: ${txError?.message}`)

    const { error: eventError } = await admin.from('sumup_transaction_events').insert({
      org_id: ORG_ID,
      transaction_id: tx.id,
      event_type: 'PAYOUT',
      status: 'SUCCESSFUL',
      amount: 774.8,
      due_date: '2026-02-02',
      installment_number: 1,
      raw: {},
    })
    if (eventError) throw new Error(`fixture setup failed: ${eventError.message}`)

    const { data: ar, error: arError } = await admin
      .from('olist_accounts_receivable')
      .insert({
        org_id: ORG_ID,
        olist_id: 999999001,
        situacao: 'aberta',
        data_vencimento: '2026-02-01',
        valor: 809.2,
        numero_documento: `${FIXTURE_PREFIX}/01`,
        forma_recebimento_nome: 'Cartão de crédito',
        raw: {},
      })
      .select('id')
      .single()
    if (arError || !ar) throw new Error(`fixture setup failed: ${arError?.message}`)

    const { runReconciliation } = await import('@/lib/reconciliation')

    const first = await runReconciliation(ORG_ID)
    expect(first.processed).toBeGreaterThanOrEqual(1)

    const { data: matchAfterFirst } = await admin
      .from('reconciliation_matches')
      .select('id, status, sumup_transaction_event_id')
      .eq('org_id', ORG_ID)
      .eq('olist_accounts_receivable_id', ar.id)
      .single()

    expect(matchAfterFirst?.status).toBe('reconciliado_automaticamente')
    expect(matchAfterFirst?.sumup_transaction_event_id).toBeTruthy()

    // Idempotency: running again must not duplicate or change the row.
    const second = await runReconciliation(ORG_ID)
    const { data: matchAfterSecond, count } = await admin
      .from('reconciliation_matches')
      .select('id, status', { count: 'exact' })
      .eq('org_id', ORG_ID)
      .eq('olist_accounts_receivable_id', ar.id)

    expect(count).toBe(1)
    expect(matchAfterSecond?.[0]?.status).toBe('reconciliado_automaticamente')
    void second

    if (!MEMBER.profileId) {
      // No local profile to attribute a manual confirm to — the matching
      // half of this test above is still real signal; skip only the
      // confirm-route portion rather than failing the whole suite on a
      // fresh, unseeded local instance.
      return
    }

    const { getCurrentMember } = await import('@/lib/auth/session')
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)

    // Manufacture a real conflict to exercise the confirm route meaningfully:
    // force this match back to conflito with the real event as its sole
    // candidate, then confirm it.
    await admin
      .from('reconciliation_matches')
      .update({ status: 'conflito', candidate_ids: [matchAfterFirst!.sumup_transaction_event_id] })
      .eq('id', matchAfterFirst!.id)

    const { POST } = await import('@/app/api/reconciliacao/[id]/confirmar/route')
    const response = await POST(
      new Request('http://localhost/api/reconciliacao/x/confirmar', {
        method: 'POST',
        body: JSON.stringify({ sumupTransactionEventId: matchAfterFirst!.sumup_transaction_event_id }),
      }),
      { params: Promise.resolve({ id: matchAfterFirst!.id }) }
    )
    expect(response.status).toBe(200)

    const { data: matchAfterConfirm } = await admin
      .from('reconciliation_matches')
      .select('status, resolved_by')
      .eq('id', matchAfterFirst!.id)
      .single()
    expect(matchAfterConfirm?.status).toBe('reconciliado_manualmente')
    expect(matchAfterConfirm?.resolved_by).toBe(MEMBER.profileId)
  })
})
```

If any real table/column name in this test doesn't match the actual schema (double-check against `supabase/migrations/0007_olist_integration.sql`, `0009_sumup_integration.sql`, `0011_reconciliation.sql` before running), fix the test, not the schema.

- [ ] **Step 4: Run it against local Supabase**

Ensure local Supabase is running (`npx supabase status`; `npx supabase start` if not). Run: `npm run test:integration`
Expected: PASS. If `MEMBER.profileId` ends up `null` (no seeded profile in this dev instance), the confirm-route portion is skipped — note this explicitly in your report; it is an acceptable, self-documenting degradation for a fresh local instance, not a silent gap.

- [ ] **Step 5: Confirm the rest of the suite is unaffected**

Run: `npm test`
Expected: PASS — the new integration test must not be picked up by the default `vitest.config.ts` (its `include`/exclude should already scope it out via the separate config; if `vitest.config.ts` has no explicit `include` restricting it to `tests/unit/**`, check whether `tests/integration/**` accidentally gets swept in and fix the main config's `include`/`exclude` if so).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.integration.ts tests/integration/reconciliation.test.ts package.json
git commit -m "test: add a real-database integration test for the reconciliation engine and confirm route"
```

---

### Task 8: Docs and final verification

**Files:**
- Modify: `docs/reconciliation.md`
- Modify: `docs/assumptions.md`

- [ ] **Step 1: Update `docs/reconciliation.md`**

Add a short section documenting: the `rejeitado_manualmente` status and when it's used (undoing an automatic match); the duplicate-event-claim guard and its manual-wins tie-break rule; that conflict candidates now carry amount/date in `match_reason.candidatos`; and how to run the new integration test (`npm run test:integration`, requires local Supabase running).

- [ ] **Step 2: Update `docs/assumptions.md`**

In the "Riscos conhecidos (Fase 4 — Reconciliação)" section, either remove or mark as resolved the risk entries this plan directly addressed (the FK-repair-pass entry should note the duplicate-claim guard now also runs; if there's an entry about "undo doesn't stick," note it's resolved by `rejeitado_manualmente`). Read the current section before editing — some entries from the original Fase 4 branch may already describe exactly what this plan fixes and just need a one-line "resolved by ..." note rather than deletion (deletion loses the historical context of why the code looks the way it does).

- [ ] **Step 3: Run full verification**

```bash
npm test
npm run lint
npx tsc --noEmit
npm run test:integration   # requires local Supabase running
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/reconciliation.md docs/assumptions.md
git commit -m "docs: document the duplicate-claim guard, rejected status, and integration test"
```

## Acceptance Checklist

- [ ] Two AR installments can never both hold `reconciliado_automaticamente`/`reconciliado_manualmente` pointing at the same SumUp event — the dedup pass demotes the loser to `conflito`.
- [ ] A manual resolution is never silently overridden by an automatic one in the dedup guard.
- [ ] The "Confirmar" button shows a candidate's SumUp amount and date, not just a raw id fragment (falls back gracefully when detail is unavailable).
- [ ] Undoing a `reconciliado_automaticamente` match sets `rejeitado_manualmente`, which the engine never re-matches.
- [ ] Undoing a `reconciliado_manualmente` match still resets to `nao_reconciliado` (unchanged behavior).
- [ ] `npm run test:integration` exercises the real engine and confirm route against a live local Postgres and passes.
- [ ] `npm test`, `npm run lint`, `npx tsc --noEmit` all pass.
