# Fase 6 (parte B) — Planejamento de Receita: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Planejamento de Receita subsystem — a versioned monthly revenue plan (`forecast_versions`/`forecast_entries`), percentage scenarios (`forecast_scenarios`/`forecast_scenario_multipliers`), and the Forecast vs Realizado report — replacing the `Planejamento`/`Cenários` `EmptyState` placeholders.

**Architecture:** Pure functions (`lib/forecast/scenarios.ts`, `lib/forecast/compare.ts`) tested with deterministic fixtures, wired to an I/O layer (`lib/forecast/engine.ts`) that follows the exact `fetchAllPages`/service-role pattern already established in `lib/reconciliation/run.ts` and `lib/cash-flow/engine.ts`. No projection into the cash flow engine in this phase — that is a separate future sub-project ("C" in the spec).

**Tech Stack:** Same as the rest of the project — Next.js 16, Supabase/Postgres, TypeScript, Zod, Vitest, plain Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-16-fase6-planejamento-receita-design.md`

## Global Constraints

- `forecast_entries.receita` always represents the raw (100%) planned value — a scenario's percentual is applied on read (`applyScenario`), never persisted into `forecast_entries`.
- The "current" version is always the org's `forecast_versions` row with the most recent `created_at` — never a separate flag. Only the current version is editable; older versions are read-only.
- Every I/O function in `lib/forecast/engine.ts` that accepts a foreign-key id from an API request (`versionId`, `scenarioId`, `duplicateFromScenarioId`) **must** verify that id belongs to the caller's `orgId` before reading or writing it. `service_role` bypasses RLS, so this in-code check is the only tenant isolation for these writes — skipping it lets one org read or overwrite another org's forecast data.
- `forecast_versions.created_by`, `forecast_entries.updated_by`, and `forecast_scenarios.created_by` are nullable — the seed migration (Task 2) inserts rows with no human author (no profile is guaranteed to exist at migration time; `profiles` rows are only created via the `handle_new_user` trigger on real signup). Every write coming through the API routes (Tasks 8–11) always sets a real `profile_id`; `null` only ever appears on seed rows.
- `olist_orders.valor_total_pedido` is summed **without** filtering by `situacao` for the Forecast vs Realizado report. Confirmed against the real local database: `situacao` has 7 distinct integer codes in production data (`0, 1, 3, 4, 5, 6, 7`), none of them documented in this codebase or in `docs/integrations/olist.md`, and `lib/olist/sync/orders.ts` does not filter by `situacao` when syncing. Guessing which code means "cancelado" would risk silently mis-stating revenue — see `docs/superpowers/specs/2026-08-16-fase6-planejamento-receita-design.md` "Riscos e suposições" and Task 15's `docs/assumptions.md` update.
- Follow existing project conventions throughout: no ORM, hand-written Supabase queries, Zod validation at every API boundary, Portuguese UI copy, `formatBRL`/`formatDateOnlyBR` for display formatting only.

---

### Task 1: Migration — `forecast_versions`, `forecast_entries`, `forecast_scenarios`, `forecast_scenario_multipliers`

**Files:**
- Create: `supabase/migrations/0014_forecast_planning.sql`

**Interfaces:**
- Produces: tables `forecast_versions(id, org_id, name, created_by, created_at)`, `forecast_entries(id, version_id, ano, mes, receita, updated_by, updated_at)`, `forecast_scenarios(id, org_id, name, created_by, created_at)`, `forecast_scenario_multipliers(scenario_id, ano, mes, percentual)`.

- [ ] **Step 1: Confirm local Supabase is running**

Run: `npx supabase status`
Expected: shows `API_URL`/`DB_URL` (running). If stopped, run `npx supabase start`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0014_forecast_planning.sql`:

```sql
-- Fase 6 (parte B): Planejamento de Receita (Prompt Mestre seções 14-17, 32).
-- See docs/superpowers/specs/2026-08-16-fase6-planejamento-receita-design.md.

create table forecast_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  -- Nullable: the seed migration (0015) inserts a "Planejamento Original"
  -- version with no human author. Every write coming through
  -- POST /api/forecast/versoes always sets a real profile id.
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index forecast_versions_org_id_created_at_idx
  on forecast_versions(org_id, created_at desc);

alter table forecast_versions enable row level security;
-- No insert/update/delete policy for anon/authenticated on purpose: writes
-- only via service_role from app/api/forecast/versoes/route.ts, which
-- enforces canEditForecast before writing. A version is never updated or
-- deleted once created — revising the forecast creates a new version.

create policy "members can read forecast_versions in their org" on forecast_versions
  for select using (is_org_member(org_id));

create table forecast_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references forecast_versions(id) on delete cascade,
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  receita numeric not null default 0,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (version_id, ano, mes)
);

create index forecast_entries_version_id_idx on forecast_entries(version_id);

alter table forecast_entries enable row level security;
-- No org_id column here (scoped through version_id) — the read policy joins
-- back to forecast_versions to check org membership. Writes only via
-- service_role from app/api/forecast/entradas/route.ts.

create policy "members can read forecast_entries in their org" on forecast_entries
  for select using (
    exists (
      select 1 from forecast_versions v
      where v.id = forecast_entries.version_id and is_org_member(v.org_id)
    )
  );

create table forecast_scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index forecast_scenarios_org_id_idx on forecast_scenarios(org_id);

alter table forecast_scenarios enable row level security;
-- Writes only via service_role from app/api/forecast/cenarios/route.ts,
-- gated by canCreateScenario.

create policy "members can read forecast_scenarios in their org" on forecast_scenarios
  for select using (is_org_member(org_id));

create table forecast_scenario_multipliers (
  scenario_id uuid not null references forecast_scenarios(id) on delete cascade,
  ano integer not null,
  mes integer not null check (mes between 1 and 12),
  percentual numeric not null check (percentual >= 0),
  primary key (scenario_id, ano, mes)
);

alter table forecast_scenario_multipliers enable row level security;
-- Writes only via service_role from
-- app/api/forecast/cenarios/multiplicadores/route.ts, gated by
-- canCreateScenario.

create policy "members can read forecast_scenario_multipliers in their org" on forecast_scenario_multipliers
  for select using (
    exists (
      select 1 from forecast_scenarios s
      where s.id = forecast_scenario_multipliers.scenario_id and is_org_member(s.org_id)
    )
  );
```

- [ ] **Step 3: Apply and verify locally**

Run: `npx supabase migration up`
Expected: applies cleanly with no errors.

Run:
```sql
select table_name from information_schema.tables
where table_name in ('forecast_versions', 'forecast_entries', 'forecast_scenarios', 'forecast_scenario_multipliers');
```
(via Supabase Studio SQL editor at the `STUDIO_URL` from `npx supabase status`)
Expected: all four table names returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0014_forecast_planning.sql
git commit -m "feat: add forecast_versions, forecast_entries, forecast_scenarios, forecast_scenario_multipliers tables"
```

---

### Task 2: Migration — seed data (Planejamento Original + Base/Conservador/Otimista)

**Files:**
- Create: `supabase/migrations/0015_forecast_planning_seed.sql`

**Interfaces:**
- Consumes: tables from Task 1.
- Produces: one `forecast_versions` row ("Planejamento Original") with 55 `forecast_entries` rows (2026-06 through 2030-12, values from Prompt Mestre seção 17); three `forecast_scenarios` rows ("Base", "Conservador", "Otimista") each with 55 `forecast_scenario_multipliers` rows (100/85/115) covering the same months.

- [ ] **Step 1: Write the seed migration**

Create `supabase/migrations/0015_forecast_planning_seed.sql`:

```sql
-- Seed data for Fase 6 (parte B), Prompt Mestre seção 17. Editable
-- afterward through the Planejamento/Cenários screens — this is a
-- starting point, not a hardcoded projection (seção 14: "Nunca hardcodar
-- a projeção no código" — this lives in the database, not in app code).

with version as (
  insert into forecast_versions (org_id, name)
  values ('00000000-0000-0000-0000-000000000001', 'Planejamento Original')
  returning id
)
insert into forecast_entries (version_id, ano, mes, receita)
select version.id, v.ano, v.mes, v.receita
from version, (values
  (2026,6,35500), (2026,7,38000), (2026,8,77500), (2026,9,39500), (2026,10,55000), (2026,11,55000), (2026,12,115000),
  (2027,1,27000), (2027,2,45000), (2027,3,45000), (2027,4,57000), (2027,5,65000), (2027,6,55000),
  (2027,7,55000), (2027,8,105000), (2027,9,60000), (2027,10,67000), (2027,11,75000), (2027,12,135000),
  (2028,1,35100), (2028,2,58500), (2028,3,58500), (2028,4,74100), (2028,5,84500), (2028,6,71500),
  (2028,7,71500), (2028,8,136500), (2028,9,78000), (2028,10,87100), (2028,11,97500), (2028,12,175500),
  (2029,1,35100), (2029,2,58500), (2029,3,58500), (2029,4,74100), (2029,5,84500), (2029,6,71500),
  (2029,7,71500), (2029,8,136500), (2029,9,78000), (2029,10,87100), (2029,11,97500), (2029,12,175500),
  (2030,1,35100), (2030,2,58500), (2030,3,58500), (2030,4,74100), (2030,5,84500), (2030,6,71500),
  (2030,7,71500), (2030,8,136500), (2030,9,78000), (2030,10,87100), (2030,11,97500), (2030,12,175500)
) as v(ano, mes, receita);

insert into forecast_scenarios (org_id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Base'),
  ('00000000-0000-0000-0000-000000000001', 'Conservador'),
  ('00000000-0000-0000-0000-000000000001', 'Otimista');

with scenario_percentuais(name, percentual) as (
  values ('Base', 100), ('Conservador', 85), ('Otimista', 115)
),
meses(ano, mes) as (
  values
  (2026,6), (2026,7), (2026,8), (2026,9), (2026,10), (2026,11), (2026,12),
  (2027,1), (2027,2), (2027,3), (2027,4), (2027,5), (2027,6),
  (2027,7), (2027,8), (2027,9), (2027,10), (2027,11), (2027,12),
  (2028,1), (2028,2), (2028,3), (2028,4), (2028,5), (2028,6),
  (2028,7), (2028,8), (2028,9), (2028,10), (2028,11), (2028,12),
  (2029,1), (2029,2), (2029,3), (2029,4), (2029,5), (2029,6),
  (2029,7), (2029,8), (2029,9), (2029,10), (2029,11), (2029,12),
  (2030,1), (2030,2), (2030,3), (2030,4), (2030,5), (2030,6),
  (2030,7), (2030,8), (2030,9), (2030,10), (2030,11), (2030,12)
)
insert into forecast_scenario_multipliers (scenario_id, ano, mes, percentual)
select s.id, m.ano, m.mes, sp.percentual
from forecast_scenarios s
join scenario_percentuais sp on sp.name = s.name
cross join meses m
where s.org_id = '00000000-0000-0000-0000-000000000001';
```

- [ ] **Step 2: Apply and verify locally**

Run: `npx supabase migration up`
Expected: applies cleanly.

Run:
```sql
select
  (select count(*) from forecast_versions where org_id = '00000000-0000-0000-0000-000000000001') as versions,
  (select count(*) from forecast_entries) as entries,
  (select count(*) from forecast_scenarios where org_id = '00000000-0000-0000-0000-000000000001') as scenarios,
  (select count(*) from forecast_scenario_multipliers) as multipliers;
```
Expected: `versions = 1`, `entries = 55`, `scenarios = 3`, `multipliers = 165`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0015_forecast_planning_seed.sql
git commit -m "feat: seed Planejamento Original version and Base/Conservador/Otimista scenarios"
```

---

### Task 3: Pure scenario multiplier — `lib/forecast/scenarios.ts`

**Files:**
- Create: `lib/forecast/scenarios.ts`
- Test: `tests/unit/forecast/scenarios.test.ts`

**Interfaces:**
- Produces: `MonthlyValue` type, `applyScenario(entries: MonthlyValue[], multipliers: MonthlyValue[]): MonthlyValue[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/forecast/scenarios.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { applyScenario } from '@/lib/forecast/scenarios'

describe('applyScenario', () => {
  it('multiplies each entry by its matching percentual', () => {
    const result = applyScenario([{ ano: 2026, mes: 8, value: 1000 }], [{ ano: 2026, mes: 8, value: 85 }])
    expect(result).toEqual([{ ano: 2026, mes: 8, value: 850 }])
  })

  it('treats a missing multiplier as 100%, never dropping the month', () => {
    const result = applyScenario([{ ano: 2026, mes: 9, value: 500 }], [])
    expect(result).toEqual([{ ano: 2026, mes: 9, value: 500 }])
  })

  it('applies a different percentual per month independently', () => {
    const result = applyScenario(
      [
        { ano: 2026, mes: 8, value: 1000 },
        { ano: 2026, mes: 9, value: 1000 },
      ],
      [
        { ano: 2026, mes: 8, value: 85 },
        { ano: 2026, mes: 9, value: 115 },
      ]
    )
    expect(result).toEqual([
      { ano: 2026, mes: 8, value: 850 },
      { ano: 2026, mes: 9, value: 1150 },
    ])
  })

  it('returns an empty array for an empty entries list', () => {
    expect(applyScenario([], [{ ano: 2026, mes: 8, value: 85 }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/forecast/scenarios.test.ts`
Expected: FAIL — `lib/forecast/scenarios.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/forecast/scenarios.ts`:

```typescript
export type MonthlyValue = { ano: number; mes: number; value: number }

function monthKey(ano: number, mes: number): string {
  return `${ano}-${mes}`
}

/**
 * Applies a scenario's monthly percentual multiplier to raw forecast
 * values. A (ano, mes) with no multiplier row is treated as 100% — never
 * dropped, since a scenario created before a version's months existed
 * would otherwise silently blank out those months instead of showing the
 * unmultiplied plan.
 */
export function applyScenario(entries: MonthlyValue[], multipliers: MonthlyValue[]): MonthlyValue[] {
  const multiplierMap = new Map(multipliers.map((m) => [monthKey(m.ano, m.mes), m.value]))
  return entries.map((entry) => {
    const percentual = multiplierMap.get(monthKey(entry.ano, entry.mes)) ?? 100
    return { ano: entry.ano, mes: entry.mes, value: (entry.value * percentual) / 100 }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/forecast/scenarios.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/scenarios.ts tests/unit/forecast/scenarios.test.ts
git commit -m "feat: add applyScenario, the pure percentual-multiplier function"
```

---

### Task 4: Pure comparison — `lib/forecast/compare.ts`

**Files:**
- Create: `lib/forecast/compare.ts`
- Test: `tests/unit/forecast/compare.test.ts`

**Interfaces:**
- Consumes: `MonthlyValue` from `lib/forecast/scenarios.ts` (Task 3).
- Produces: `YearMonth` type, `ForecastVsRealizadoRow` type, `compareForecastToActual(planejado: MonthlyValue[], realizadoSums: MonthlyValue[], today: YearMonth): ForecastVsRealizadoRow[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/forecast/compare.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { compareForecastToActual } from '@/lib/forecast/compare'

describe('compareForecastToActual', () => {
  it('computes the R$ and % difference when both planejado and realizado exist', () => {
    const rows = compareForecastToActual(
      [{ ano: 2026, mes: 6, value: 1000 }],
      [{ ano: 2026, mes: 6, value: 1200 }],
      { ano: 2026, mes: 8 }
    )
    expect(rows).toEqual([
      { ano: 2026, mes: 6, planejado: 1000, realizado: 1200, diferencaAbsoluta: 200, diferencaPercentual: 0.2 },
    ])
  })

  it('treats a past month with no synced orders as realizado = 0, not null', () => {
    const rows = compareForecastToActual([{ ano: 2026, mes: 6, value: 1000 }], [], { ano: 2026, mes: 8 })
    expect(rows[0]).toMatchObject({ realizado: 0, diferencaAbsoluta: -1000 })
  })

  it('treats the current month with no synced orders as realizado = null (not confirmed zero yet)', () => {
    const rows = compareForecastToActual([{ ano: 2026, mes: 8, value: 1000 }], [], { ano: 2026, mes: 8 })
    expect(rows[0]).toMatchObject({ realizado: null, diferencaAbsoluta: null, diferencaPercentual: null })
  })

  it('treats a future month with no synced orders as realizado = null', () => {
    const rows = compareForecastToActual([{ ano: 2026, mes: 12, value: 1000 }], [], { ano: 2026, mes: 8 })
    expect(rows[0]).toMatchObject({ realizado: null, diferencaAbsoluta: null, diferencaPercentual: null })
  })

  it('never divides by zero: diferencaPercentual is null when planejado is 0', () => {
    const rows = compareForecastToActual([{ ano: 2026, mes: 6, value: 0 }], [{ ano: 2026, mes: 6, value: 500 }], {
      ano: 2026,
      mes: 8,
    })
    expect(rows[0]).toMatchObject({ diferencaAbsoluta: 500, diferencaPercentual: null })
  })

  it('produces one row per planejado month, in the same order', () => {
    const rows = compareForecastToActual(
      [
        { ano: 2026, mes: 6, value: 100 },
        { ano: 2026, mes: 7, value: 200 },
      ],
      [{ ano: 2026, mes: 7, value: 250 }],
      { ano: 2026, mes: 8 }
    )
    expect(rows.map((r) => r.mes)).toEqual([6, 7])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/forecast/compare.test.ts`
Expected: FAIL — `lib/forecast/compare.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/forecast/compare.ts`:

```typescript
import type { MonthlyValue } from '@/lib/forecast/scenarios'

export type YearMonth = { ano: number; mes: number }

export type ForecastVsRealizadoRow = {
  ano: number
  mes: number
  planejado: number
  realizado: number | null
  diferencaAbsoluta: number | null
  diferencaPercentual: number | null
}

function monthKey(ano: number, mes: number): string {
  return `${ano}-${mes}`
}

function isBefore(a: YearMonth, b: YearMonth): boolean {
  return a.ano * 12 + a.mes < b.ano * 12 + b.mes
}

/**
 * Compares planned vs. actual revenue per month.
 *
 * `realizadoSums` only contains months that have at least one synced
 * `olist_orders` row (see `loadRealizadoByMonth`) — a month absent from it
 * means "no orders found for that month", which is ambiguous on its own:
 * for a month strictly before `today`, absence is a confirmed `0` (the
 * sync has had time to see everything for that month); for `today`'s
 * month or later, absence means the data doesn't exist yet and must not
 * be shown as if it were a confirmed zero — it resolves to `null`
 * ("—" in the UI, per Prompt Mestre seção 32).
 *
 * `diferencaPercentual` is `null` whenever `realizado` is `null` or
 * `planejado` is `0` — never a disguised divide-by-zero.
 */
export function compareForecastToActual(
  planejado: MonthlyValue[],
  realizadoSums: MonthlyValue[],
  today: YearMonth
): ForecastVsRealizadoRow[] {
  const realizadoMap = new Map(realizadoSums.map((r) => [monthKey(r.ano, r.mes), r.value]))

  return planejado.map((p) => {
    const month = { ano: p.ano, mes: p.mes }
    const known = realizadoMap.get(monthKey(p.ano, p.mes))
    const realizado = known !== undefined ? known : isBefore(month, today) ? 0 : null

    const diferencaAbsoluta = realizado === null ? null : realizado - p.value
    const diferencaPercentual = realizado === null || p.value === 0 ? null : (diferencaAbsoluta as number) / p.value

    return { ano: p.ano, mes: p.mes, planejado: p.value, realizado, diferencaAbsoluta, diferencaPercentual }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/forecast/compare.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/compare.ts tests/unit/forecast/compare.test.ts
git commit -m "feat: add compareForecastToActual for the Forecast vs Realizado report"
```

---

### Task 5: Validation schemas — `lib/validation/forecast.ts`

**Files:**
- Create: `lib/validation/forecast.ts`
- Test: `tests/unit/validation/forecast.test.ts`

**Interfaces:**
- Produces: `updateForecastEntrySchema`, `UpdateForecastEntryInput`, `createForecastVersionSchema`, `CreateForecastVersionInput`, `createForecastScenarioSchema`, `CreateForecastScenarioInput`, `updateScenarioMultiplierSchema`, `UpdateScenarioMultiplierInput`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/validation/forecast.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  updateForecastEntrySchema,
  createForecastVersionSchema,
  createForecastScenarioSchema,
  updateScenarioMultiplierSchema,
} from '@/lib/validation/forecast'

describe('updateForecastEntrySchema', () => {
  const valid = { versionId: '00000000-0000-0000-0000-000000000002', ano: 2026, mes: 8, receita: 1000 }

  it('accepts a valid entry with optional cenario/comentario', () => {
    expect(updateForecastEntrySchema.safeParse({ ...valid, cenario: 'Base', comentario: 'Ajuste' }).success).toBe(true)
  })

  it('accepts a valid entry without cenario/comentario', () => {
    expect(updateForecastEntrySchema.safeParse(valid).success).toBe(true)
  })

  it('rejects mes outside 1-12', () => {
    expect(updateForecastEntrySchema.safeParse({ ...valid, mes: 13 }).success).toBe(false)
  })

  it('rejects a negative receita', () => {
    expect(updateForecastEntrySchema.safeParse({ ...valid, receita: -1 }).success).toBe(false)
  })

  it('rejects an invalid versionId', () => {
    expect(updateForecastEntrySchema.safeParse({ ...valid, versionId: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('createForecastVersionSchema', () => {
  it('accepts a non-empty name', () => {
    expect(createForecastVersionSchema.safeParse({ name: 'Forecast Setembro 2026' }).success).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(createForecastVersionSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('createForecastScenarioSchema', () => {
  it('accepts a name with no duplicateFromScenarioId', () => {
    expect(createForecastScenarioSchema.safeParse({ name: 'Pessimista' }).success).toBe(true)
  })

  it('accepts a name with a valid duplicateFromScenarioId', () => {
    expect(
      createForecastScenarioSchema.safeParse({
        name: 'Pessimista',
        duplicateFromScenarioId: '00000000-0000-0000-0000-000000000003',
      }).success
    ).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(createForecastScenarioSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('updateScenarioMultiplierSchema', () => {
  const valid = { scenarioId: '00000000-0000-0000-0000-000000000004', ano: 2026, mes: 8, percentual: 85 }

  it('accepts a valid multiplier', () => {
    expect(updateScenarioMultiplierSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a negative percentual', () => {
    expect(updateScenarioMultiplierSchema.safeParse({ ...valid, percentual: -10 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/validation/forecast.test.ts`
Expected: FAIL — `lib/validation/forecast.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/validation/forecast.ts`:

```typescript
import { z } from 'zod'

export const updateForecastEntrySchema = z.object({
  versionId: z.string().uuid(),
  ano: z.number().int().min(2000).max(2100),
  mes: z.number().int().min(1).max(12),
  receita: z.number().min(0),
  cenario: z.string().optional(),
  comentario: z.string().max(500).optional(),
})

export const createForecastVersionSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(200),
})

export const createForecastScenarioSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(200),
  duplicateFromScenarioId: z.string().uuid().optional(),
})

export const updateScenarioMultiplierSchema = z.object({
  scenarioId: z.string().uuid(),
  ano: z.number().int().min(2000).max(2100),
  mes: z.number().int().min(1).max(12),
  percentual: z.number().min(0),
})

export type UpdateForecastEntryInput = z.infer<typeof updateForecastEntrySchema>
export type CreateForecastVersionInput = z.infer<typeof createForecastVersionSchema>
export type CreateForecastScenarioInput = z.infer<typeof createForecastScenarioSchema>
export type UpdateScenarioMultiplierInput = z.infer<typeof updateScenarioMultiplierSchema>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/validation/forecast.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/validation/forecast.ts tests/unit/validation/forecast.test.ts
git commit -m "feat: add Zod validation schemas for the forecast API routes"
```

---

### Task 6: Engine I/O — read layer (`lib/forecast/engine.ts`)

**Files:**
- Create: `lib/forecast/engine.ts`
- Test: `tests/unit/forecast/engine.test.ts`

**Interfaces:**
- Consumes: `fetchAllPages` from `lib/reconciliation/run.ts`; `MonthlyValue` from `lib/forecast/scenarios.ts` (Task 3).
- Produces: `ForecastVersion`, `ForecastScenario` types; `loadAllVersions(orgId): Promise<ForecastVersion[]>`; `loadVersionEntries(orgId, versionId): Promise<MonthlyValue[]>`; `loadScenarios(orgId): Promise<Array<{ scenario: ForecastScenario; multipliers: MonthlyValue[] }>>`; `loadRealizadoByMonth(orgId): Promise<MonthlyValue[]>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/forecast/engine.test.ts`. Mirrors the `mockAdmin` pattern in `tests/unit/cash-flow/engine.test.ts`.

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { loadAllVersions, loadVersionEntries, loadScenarios, loadRealizadoByMonth } from '@/lib/forecast/engine'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const OTHER_ORG_ID = '00000000-0000-0000-0000-000000000099'

type Row = Record<string, unknown>

function makePageableChain(rows: Row[]) {
  let from = 0
  let to = 499
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.not = vi.fn(() => chain)
  chain.range = vi.fn((nextFrom: number, nextTo: number) => {
    from = nextFrom
    to = nextTo
    return chain
  })
  chain.then = (resolve: (value: { data: Row[]; error: null }) => unknown) =>
    resolve({ data: rows.slice(from, to + 1), error: null })
  return chain
}

function makeSingleChain(row: Row | null) {
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: row, error: null }))
  return chain
}

function mockAdmin(options: {
  versionRows?: Row[]
  entryRows?: Row[]
  scenarioRows?: Row[]
  multiplierRowsByScenario?: Record<string, Row[]>
  orderRows?: Row[]
  versionLookup?: Row | null
}) {
  const versionRows = options.versionRows ?? []
  const entryRows = options.entryRows ?? []
  const scenarioRows = options.scenarioRows ?? []
  const multiplierRowsByScenario = options.multiplierRowsByScenario ?? {}
  const orderRows = options.orderRows ?? []

  const from = vi.fn((table: string) => {
    if (table === 'forecast_versions') {
      return {
        select: vi.fn((columns: string) => {
          if (columns === 'id') return makeSingleChain(options.versionLookup ?? null)
          return makePageableChain(versionRows)
        }),
      }
    }
    if (table === 'forecast_entries') return { select: vi.fn(() => makePageableChain(entryRows)) }
    if (table === 'forecast_scenarios') return { select: vi.fn(() => makePageableChain(scenarioRows)) }
    if (table === 'forecast_scenario_multipliers') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, scenarioId: string) => makePageableChain(multiplierRowsByScenario[scenarioId] ?? [])),
        })),
      }
    }
    if (table === 'olist_orders') return { select: vi.fn(() => makePageableChain(orderRows)) }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
}

describe('loadAllVersions', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns versions ordered most-recent-first', async () => {
    mockAdmin({
      versionRows: [
        { id: 'v-2', name: 'Forecast Agosto 2026', created_at: '2026-08-01T00:00:00Z' },
        { id: 'v-1', name: 'Planejamento Original', created_at: '2026-06-01T00:00:00Z' },
      ],
    })

    const versions = await loadAllVersions(ORG_ID)

    expect(versions).toEqual([
      { id: 'v-2', name: 'Forecast Agosto 2026', createdAt: '2026-08-01T00:00:00Z' },
      { id: 'v-1', name: 'Planejamento Original', createdAt: '2026-06-01T00:00:00Z' },
    ])
  })
})

describe('loadVersionEntries', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns the entries of a version that belongs to the org', async () => {
    mockAdmin({
      versionLookup: { id: 'v-1' },
      entryRows: [{ ano: 2026, mes: 8, receita: 1000 }],
    })

    const entries = await loadVersionEntries(ORG_ID, 'v-1')

    expect(entries).toEqual([{ ano: 2026, mes: 8, value: 1000 }])
  })

  it('throws when the version does not belong to the org', async () => {
    mockAdmin({ versionLookup: null })

    await expect(loadVersionEntries(OTHER_ORG_ID, 'v-1')).rejects.toThrow('Versão não encontrada')
  })
})

describe('loadScenarios', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns each scenario with its own multipliers', async () => {
    mockAdmin({
      scenarioRows: [{ id: 's-1', name: 'Base', created_at: '2026-06-01T00:00:00Z' }],
      multiplierRowsByScenario: { 's-1': [{ ano: 2026, mes: 8, percentual: 100 }] },
    })

    const scenarios = await loadScenarios(ORG_ID)

    expect(scenarios).toEqual([
      {
        scenario: { id: 's-1', name: 'Base', createdAt: '2026-06-01T00:00:00Z' },
        multipliers: [{ ano: 2026, mes: 8, value: 100 }],
      },
    ])
  })
})

describe('loadRealizadoByMonth', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sums valor_total_pedido grouped by month of data', async () => {
    mockAdmin({
      orderRows: [
        { data: '2026-08-05', valor_total_pedido: 100 },
        { data: '2026-08-20', valor_total_pedido: 50 },
        { data: '2026-09-01', valor_total_pedido: 200 },
      ],
    })

    const sums = await loadRealizadoByMonth(ORG_ID)

    expect(sums).toEqual(
      expect.arrayContaining([
        { ano: 2026, mes: 8, value: 150 },
        { ano: 2026, mes: 9, value: 200 },
      ])
    )
  })

  it('treats a null valor_total_pedido as 0, never NaN', async () => {
    mockAdmin({ orderRows: [{ data: '2026-08-05', valor_total_pedido: null }] })

    const sums = await loadRealizadoByMonth(ORG_ID)

    expect(sums).toEqual([{ ano: 2026, mes: 8, value: 0 }])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/forecast/engine.test.ts`
Expected: FAIL — `lib/forecast/engine.ts` doesn't exist yet.

- [ ] **Step 3: Implement the read layer**

Create `lib/forecast/engine.ts`:

```typescript
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/reconciliation/run'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

type AdminClient = ReturnType<typeof createAdminSupabaseClient>

export type ForecastVersion = { id: string; name: string; createdAt: string }
export type ForecastScenario = { id: string; name: string; createdAt: string }

type VersionRow = { id: string; name: string; created_at: string }
type EntryRow = { ano: number; mes: number; receita: number }

/** Ordered most-recent-first: `versions[0]` is always the editable "current" version. */
export async function loadAllVersions(orgId: string): Promise<ForecastVersion[]> {
  const admin = createAdminSupabaseClient()
  const rows = await fetchAllPages<VersionRow>(
    (from, to) =>
      admin
        .from('forecast_versions')
        .select('id, name, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .range(from, to),
    'Failed to load forecast_versions'
  )
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }))
}

/**
 * Loads a version's entries after confirming the version belongs to
 * `orgId` — `service_role` bypasses RLS, so this explicit check is what
 * stops one org from reading another org's forecast by id-guessing.
 */
export async function loadVersionEntries(orgId: string, versionId: string): Promise<MonthlyValue[]> {
  const admin = createAdminSupabaseClient()

  const { data: version, error: versionError } = await admin
    .from('forecast_versions')
    .select('id')
    .eq('id', versionId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (versionError) throw new Error(`Failed to load forecast_versions: ${versionError.message}`)
  if (!version) throw new Error('Versão não encontrada')

  const rows = await fetchAllPages<EntryRow>(
    (from, to) =>
      admin
        .from('forecast_entries')
        .select('ano, mes, receita')
        .eq('version_id', versionId)
        .order('ano')
        .order('mes')
        .range(from, to),
    'Failed to load forecast_entries'
  )
  return rows.map((r) => ({ ano: r.ano, mes: r.mes, value: r.receita }))
}

type ScenarioRow = { id: string; name: string; created_at: string }
type MultiplierRow = { ano: number; mes: number; percentual: number }

async function loadMultipliers(admin: AdminClient, scenarioId: string): Promise<MonthlyValue[]> {
  const rows = await fetchAllPages<MultiplierRow>(
    (from, to) =>
      admin
        .from('forecast_scenario_multipliers')
        .select('ano, mes, percentual')
        .eq('scenario_id', scenarioId)
        .range(from, to),
    'Failed to load forecast_scenario_multipliers'
  )
  return rows.map((r) => ({ ano: r.ano, mes: r.mes, value: r.percentual }))
}

export async function loadScenarios(
  orgId: string
): Promise<Array<{ scenario: ForecastScenario; multipliers: MonthlyValue[] }>> {
  const admin = createAdminSupabaseClient()
  const scenarios = await fetchAllPages<ScenarioRow>(
    (from, to) =>
      admin.from('forecast_scenarios').select('id, name, created_at').eq('org_id', orgId).order('created_at').range(from, to),
    'Failed to load forecast_scenarios'
  )

  const result: Array<{ scenario: ForecastScenario; multipliers: MonthlyValue[] }> = []
  for (const scenario of scenarios) {
    const multipliers = await loadMultipliers(admin, scenario.id)
    result.push({ scenario: { id: scenario.id, name: scenario.name, createdAt: scenario.created_at }, multipliers })
  }
  return result
}

type OrderRow = { data: string; valor_total_pedido: number | null }

/**
 * Sums olist_orders.valor_total_pedido by month of `data`, for every month
 * that has at least one synced order. Deliberately does NOT filter by
 * `situacao` — see the Global Constraints note on this in the plan header
 * and docs/assumptions.md ("Riscos conhecidos — Fase 6B").
 */
export async function loadRealizadoByMonth(orgId: string): Promise<MonthlyValue[]> {
  const admin = createAdminSupabaseClient()
  const rows = await fetchAllPages<OrderRow>(
    (from, to) =>
      admin.from('olist_orders').select('data, valor_total_pedido').eq('org_id', orgId).not('data', 'is', null).range(from, to),
    'Failed to load olist_orders for forecast comparison'
  )

  const totals = new Map<string, { ano: number; mes: number; value: number }>()
  for (const row of rows) {
    const [ano, mes] = row.data.split('-').map(Number)
    const key = `${ano}-${mes}`
    const existing = totals.get(key) ?? { ano, mes, value: 0 }
    existing.value += row.valor_total_pedido ?? 0
    totals.set(key, existing)
  }

  return Array.from(totals.values())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/forecast/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/engine.ts tests/unit/forecast/engine.test.ts
git commit -m "feat: add the forecast engine's read layer (versions, entries, scenarios, realizado)"
```

---

### Task 7: Engine I/O — write layer (versions, entries, scenarios, multipliers)

**Files:**
- Modify: `lib/forecast/engine.ts`
- Modify: `tests/unit/forecast/engine.test.ts`

**Interfaces:**
- Consumes: `loadAllVersions`, `loadVersionEntries` (Task 6, same file).
- Produces (added to `lib/forecast/engine.ts`): `createForecastVersion(orgId, name, actorProfileId): Promise<ForecastVersion>`; `updateForecastEntry(orgId, versionId, ano, mes, receita, actorProfileId): Promise<void>`; `createForecastScenario(orgId, name, actorProfileId, duplicateFromScenarioId?): Promise<ForecastScenario>`; `updateScenarioMultiplier(orgId, scenarioId, ano, mes, percentual): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/forecast/engine.test.ts` — extend the existing `mockAdmin` helper to support `insert`/`upsert`, and add these test blocks:

```typescript
// Add to the imports:
import {
  loadAllVersions,
  loadVersionEntries,
  loadScenarios,
  loadRealizadoByMonth,
  createForecastVersion,
  updateForecastEntry,
  createForecastScenario,
  updateScenarioMultiplier,
} from '@/lib/forecast/engine'

// Replace mockAdmin with this extended version (adds insert/upsert support):
function mockAdmin(options: {
  versionRows?: Row[]
  entryRows?: Row[]
  scenarioRows?: Row[]
  multiplierRowsByScenario?: Record<string, Row[]>
  orderRows?: Row[]
  versionLookup?: Row | null
  scenarioLookup?: Row | null
  insertedVersion?: Row
  insertedScenario?: Row
}) {
  const versionRows = options.versionRows ?? []
  const entryRows = options.entryRows ?? []
  const scenarioRows = options.scenarioRows ?? []
  const multiplierRowsByScenario = options.multiplierRowsByScenario ?? {}
  const orderRows = options.orderRows ?? []

  const versionInsertSingle = vi.fn().mockResolvedValue({ data: options.insertedVersion ?? null, error: null })
  const versionInsertSelect = vi.fn(() => ({ single: versionInsertSingle }))
  const versionInsert = vi.fn(() => ({ select: versionInsertSelect }))

  const scenarioInsertSingle = vi.fn().mockResolvedValue({ data: options.insertedScenario ?? null, error: null })
  const scenarioInsertSelect = vi.fn(() => ({ single: scenarioInsertSingle }))
  const scenarioInsert = vi.fn(() => ({ select: scenarioInsertSelect }))

  const entryInsert = vi.fn().mockResolvedValue({ error: null })
  const entryUpsert = vi.fn().mockResolvedValue({ error: null })
  const multiplierInsert = vi.fn().mockResolvedValue({ error: null })
  const multiplierUpsert = vi.fn().mockResolvedValue({ error: null })

  const from = vi.fn((table: string) => {
    if (table === 'forecast_versions') {
      return {
        select: vi.fn((columns: string) => {
          if (columns === 'id') return makeSingleChain(options.versionLookup ?? null)
          return makePageableChain(versionRows)
        }),
        insert: versionInsert,
      }
    }
    if (table === 'forecast_entries') {
      return { select: vi.fn(() => makePageableChain(entryRows)), insert: entryInsert, upsert: entryUpsert }
    }
    if (table === 'forecast_scenarios') {
      return {
        select: vi.fn((columns: string) => {
          if (columns === 'id') return makeSingleChain(options.scenarioLookup ?? null)
          return makePageableChain(scenarioRows)
        }),
        insert: scenarioInsert,
      }
    }
    if (table === 'forecast_scenario_multipliers') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, scenarioId: string) => makePageableChain(multiplierRowsByScenario[scenarioId] ?? [])),
        })),
        insert: multiplierInsert,
        upsert: multiplierUpsert,
      }
    }
    if (table === 'olist_orders') return { select: vi.fn(() => makePageableChain(orderRows)) }
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { versionInsert, scenarioInsert, entryInsert, entryUpsert, multiplierInsert, multiplierUpsert }
}

describe('createForecastVersion', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates the version and copies the current version entries into it', async () => {
    const { versionInsert, entryInsert } = mockAdmin({
      versionRows: [{ id: 'v-1', name: 'Planejamento Original', created_at: '2026-06-01T00:00:00Z' }],
      versionLookup: { id: 'v-1' },
      entryRows: [{ ano: 2026, mes: 8, receita: 1000 }],
      insertedVersion: { id: 'v-2', name: 'Forecast Agosto 2026', created_at: '2026-08-01T00:00:00Z' },
    })

    const version = await createForecastVersion(ORG_ID, 'Forecast Agosto 2026', 'profile-1')

    expect(version).toEqual({ id: 'v-2', name: 'Forecast Agosto 2026', createdAt: '2026-08-01T00:00:00Z' })
    expect(versionInsert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, name: 'Forecast Agosto 2026', created_by: 'profile-1' })
    )
    expect(entryInsert).toHaveBeenCalledWith([
      expect.objectContaining({ version_id: 'v-2', ano: 2026, mes: 8, receita: 1000, updated_by: 'profile-1' }),
    ])
  })

  it('creates a version with no entries to copy when there is no prior version', async () => {
    const { entryInsert } = mockAdmin({
      versionRows: [],
      insertedVersion: { id: 'v-1', name: 'Planejamento Original', created_at: '2026-06-01T00:00:00Z' },
    })

    await createForecastVersion(ORG_ID, 'Planejamento Original', 'profile-1')

    expect(entryInsert).not.toHaveBeenCalled()
  })
})

describe('updateForecastEntry', () => {
  afterEach(() => vi.restoreAllMocks())

  it('upserts the entry when versionId is the current version', async () => {
    const { entryUpsert } = mockAdmin({
      versionRows: [{ id: 'v-2', name: 'Atual', created_at: '2026-08-01T00:00:00Z' }],
    })

    await updateForecastEntry(ORG_ID, 'v-2', 2026, 8, 1500, 'profile-1')

    expect(entryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ version_id: 'v-2', ano: 2026, mes: 8, receita: 1500, updated_by: 'profile-1' }),
      { onConflict: 'version_id,ano,mes' }
    )
  })

  it('rejects an edit to a version that is no longer the current one', async () => {
    mockAdmin({
      versionRows: [{ id: 'v-2', name: 'Atual', created_at: '2026-08-01T00:00:00Z' }],
    })

    await expect(updateForecastEntry(ORG_ID, 'v-1', 2026, 8, 1500, 'profile-1')).rejects.toThrow(
      'Só é possível editar a versão mais recente do forecast'
    )
  })
})

describe('createForecastScenario', () => {
  afterEach(() => vi.restoreAllMocks())

  it('creates a scenario with no multipliers when duplicateFromScenarioId is not given', async () => {
    const { scenarioInsert, multiplierInsert } = mockAdmin({
      insertedScenario: { id: 's-2', name: 'Pessimista', created_at: '2026-08-01T00:00:00Z' },
    })

    const scenario = await createForecastScenario(ORG_ID, 'Pessimista', 'profile-1')

    expect(scenario).toEqual({ id: 's-2', name: 'Pessimista', createdAt: '2026-08-01T00:00:00Z' })
    expect(scenarioInsert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, name: 'Pessimista', created_by: 'profile-1' })
    )
    expect(multiplierInsert).not.toHaveBeenCalled()
  })

  it('copies the source scenario multipliers when duplicating', async () => {
    const { multiplierInsert } = mockAdmin({
      scenarioLookup: { id: 's-1' },
      multiplierRowsByScenario: { 's-1': [{ ano: 2026, mes: 8, percentual: 85 }] },
      insertedScenario: { id: 's-2', name: 'Conservador (cópia)', created_at: '2026-08-01T00:00:00Z' },
    })

    await createForecastScenario(ORG_ID, 'Conservador (cópia)', 'profile-1', 's-1')

    expect(multiplierInsert).toHaveBeenCalledWith([
      expect.objectContaining({ scenario_id: 's-2', ano: 2026, mes: 8, percentual: 85 }),
    ])
  })

  it('rejects duplicating from a scenario that does not belong to the org', async () => {
    mockAdmin({ scenarioLookup: null })

    await expect(createForecastScenario(ORG_ID, 'Cópia', 'profile-1', 's-foreign')).rejects.toThrow(
      'Cenário de origem não encontrado'
    )
  })
})

describe('updateScenarioMultiplier', () => {
  afterEach(() => vi.restoreAllMocks())

  it('upserts the multiplier when the scenario belongs to the org', async () => {
    const { multiplierUpsert } = mockAdmin({ scenarioLookup: { id: 's-1' } })

    await updateScenarioMultiplier(ORG_ID, 's-1', 2026, 8, 90)

    expect(multiplierUpsert).toHaveBeenCalledWith(
      { scenario_id: 's-1', ano: 2026, mes: 8, percentual: 90 },
      { onConflict: 'scenario_id,ano,mes' }
    )
  })

  it('rejects updating a scenario that does not belong to the org', async () => {
    mockAdmin({ scenarioLookup: null })

    await expect(updateScenarioMultiplier(ORG_ID, 's-foreign', 2026, 8, 90)).rejects.toThrow('Cenário não encontrado')
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/unit/forecast/engine.test.ts`
Expected: FAIL — the four new exports don't exist yet.

- [ ] **Step 3: Implement the write layer**

Append to `lib/forecast/engine.ts`:

```typescript
export async function createForecastVersion(orgId: string, name: string, actorProfileId: string): Promise<ForecastVersion> {
  const admin = createAdminSupabaseClient()
  const versions = await loadAllVersions(orgId)
  const current = versions[0]

  const { data: version, error: versionError } = await admin
    .from('forecast_versions')
    .insert({ org_id: orgId, name, created_by: actorProfileId })
    .select('id, name, created_at')
    .single()
  if (versionError) throw new Error(`Failed to create forecast_versions: ${versionError.message}`)

  if (current) {
    const entries = await loadVersionEntries(orgId, current.id)
    if (entries.length > 0) {
      const { error: copyError } = await admin.from('forecast_entries').insert(
        entries.map((e) => ({
          version_id: version.id,
          ano: e.ano,
          mes: e.mes,
          receita: e.value,
          updated_by: actorProfileId,
        }))
      )
      if (copyError) throw new Error(`Failed to copy forecast_entries: ${copyError.message}`)
    }
  }

  return { id: version.id, name: version.name, createdAt: version.created_at }
}

/**
 * Upserts a single cell of the planning grid. Throws if `versionId` is not
 * the org's current (most recently created) version — editing a version
 * that has been superseded would silently rewrite history instead of
 * creating a new version, which Prompt Mestre seção 15 explicitly forbids
 * ("Não sobrescrever previsões antigas").
 */
export async function updateForecastEntry(
  orgId: string,
  versionId: string,
  ano: number,
  mes: number,
  receita: number,
  actorProfileId: string
): Promise<void> {
  const admin = createAdminSupabaseClient()
  const versions = await loadAllVersions(orgId)
  const current = versions[0]
  if (!current || current.id !== versionId) {
    throw new Error('Só é possível editar a versão mais recente do forecast')
  }

  const { error } = await admin
    .from('forecast_entries')
    .upsert(
      { version_id: versionId, ano, mes, receita, updated_by: actorProfileId, updated_at: new Date().toISOString() },
      { onConflict: 'version_id,ano,mes' }
    )
  if (error) throw new Error(`Failed to upsert forecast_entries: ${error.message}`)
}

export async function createForecastScenario(
  orgId: string,
  name: string,
  actorProfileId: string,
  duplicateFromScenarioId?: string
): Promise<ForecastScenario> {
  const admin = createAdminSupabaseClient()

  let sourceMultipliers: MonthlyValue[] = []
  if (duplicateFromScenarioId) {
    const { data: source, error: sourceError } = await admin
      .from('forecast_scenarios')
      .select('id')
      .eq('id', duplicateFromScenarioId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (sourceError) throw new Error(`Failed to load forecast_scenarios: ${sourceError.message}`)
    if (!source) throw new Error('Cenário de origem não encontrado')
    sourceMultipliers = await loadMultipliers(admin, duplicateFromScenarioId)
  }

  const { data: scenario, error: scenarioError } = await admin
    .from('forecast_scenarios')
    .insert({ org_id: orgId, name, created_by: actorProfileId })
    .select('id, name, created_at')
    .single()
  if (scenarioError) throw new Error(`Failed to create forecast_scenarios: ${scenarioError.message}`)

  if (sourceMultipliers.length > 0) {
    const { error: copyError } = await admin.from('forecast_scenario_multipliers').insert(
      sourceMultipliers.map((m) => ({ scenario_id: scenario.id, ano: m.ano, mes: m.mes, percentual: m.value }))
    )
    if (copyError) throw new Error(`Failed to duplicate forecast_scenario_multipliers: ${copyError.message}`)
  }

  return { id: scenario.id, name: scenario.name, createdAt: scenario.created_at }
}

/**
 * Upserts a single scenario/month multiplier, after confirming `scenarioId`
 * belongs to `orgId` — same tenant-isolation reasoning as
 * `loadVersionEntries` above.
 */
export async function updateScenarioMultiplier(
  orgId: string,
  scenarioId: string,
  ano: number,
  mes: number,
  percentual: number
): Promise<void> {
  const admin = createAdminSupabaseClient()

  const { data: scenario, error: scenarioError } = await admin
    .from('forecast_scenarios')
    .select('id')
    .eq('id', scenarioId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (scenarioError) throw new Error(`Failed to load forecast_scenarios: ${scenarioError.message}`)
  if (!scenario) throw new Error('Cenário não encontrado')

  const { error } = await admin
    .from('forecast_scenario_multipliers')
    .upsert({ scenario_id: scenarioId, ano, mes, percentual }, { onConflict: 'scenario_id,ano,mes' })
  if (error) throw new Error(`Failed to upsert forecast_scenario_multipliers: ${error.message}`)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/forecast/engine.test.ts`
Expected: PASS (all tests, read + write layer)

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/forecast/engine.ts tests/unit/forecast/engine.test.ts
git commit -m "feat: add the forecast engine's write layer (versions, entries, scenarios, multipliers)"
```

---

### Task 8: API route — `POST /api/forecast/versoes`

**Files:**
- Create: `app/api/forecast/versoes/route.ts`
- Test: `tests/unit/forecast/versoes-route.test.ts`

**Interfaces:**
- Consumes: `getCurrentMember` from `lib/auth/session.ts`; `canEditForecast` from `lib/auth/rbac.ts`; `createForecastVersionSchema` from `lib/validation/forecast.ts` (Task 5); `createForecastVersion` from `lib/forecast/engine.ts` (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/forecast/versoes-route.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canEditForecast: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({ createForecastVersion: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { createForecastVersion } from '@/lib/forecast/engine'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/forecast/versoes', { method: 'POST', body: JSON.stringify(body) })
}

function mockAdmin() {
  const auditInsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') return { insert: auditInsert }
    throw new Error(`unexpected table ${table}`)
  })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { auditInsert }
}

describe('POST /api/forecast/versoes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when there is no member', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(null)

    const { POST } = await import('@/app/api/forecast/versoes/route')
    const response = await POST(buildRequest({ name: 'Forecast Agosto 2026' }))

    expect(response.status).toBe(403)
  })

  it('returns 403 when the member lacks canEditForecast', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canEditForecast).mockReturnValue(false)

    const { POST } = await import('@/app/api/forecast/versoes/route')
    const response = await POST(buildRequest({ name: 'Forecast Agosto 2026' }))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)

    const { POST } = await import('@/app/api/forecast/versoes/route')
    const response = await POST(buildRequest({ name: '' }))

    expect(response.status).toBe(400)
  })

  it('creates the version, writes an audit log, and returns it on a valid request', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)
    vi.mocked(createForecastVersion).mockResolvedValue({
      id: 'v-2',
      name: 'Forecast Agosto 2026',
      createdAt: '2026-08-01T00:00:00Z',
    })
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/versoes/route')
    const response = await POST(buildRequest({ name: 'Forecast Agosto 2026' }))
    const body = await response.json()

    expect(body).toEqual({ ok: true, version: { id: 'v-2', name: 'Forecast Agosto 2026', createdAt: '2026-08-01T00:00:00Z' } })
    expect(createForecastVersion).toHaveBeenCalledWith(ORG_ID, 'Forecast Agosto 2026', 'profile-1')
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, actor_profile_id: 'profile-1', action: 'forecast_version_created' })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/forecast/versoes-route.test.ts`
Expected: FAIL — `app/api/forecast/versoes/route.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `app/api/forecast/versoes/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createForecastVersionSchema } from '@/lib/validation/forecast'
import { createForecastVersion } from '@/lib/forecast/engine'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canEditForecast(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = createForecastVersionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }

  const version = await createForecastVersion(member.orgId, parsed.data.name, member.profileId)

  const admin = createAdminSupabaseClient()
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'forecast_version_created',
    entity: 'forecast_versions',
    entity_id: version.id,
    after: { name: version.name },
  })
  if (auditError) {
    console.error('Failed to write audit_logs for forecast_version_created:', auditError.message)
  }

  return NextResponse.json({ ok: true, version })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/forecast/versoes-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/forecast/versoes/route.ts tests/unit/forecast/versoes-route.test.ts
git commit -m "feat: add POST /api/forecast/versoes"
```

---

### Task 9: API route — `POST /api/forecast/entradas`

**Files:**
- Create: `app/api/forecast/entradas/route.ts`
- Test: `tests/unit/forecast/entradas-route.test.ts`

**Interfaces:**
- Consumes: `updateForecastEntrySchema` from `lib/validation/forecast.ts` (Task 5); `updateForecastEntry` from `lib/forecast/engine.ts` (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/forecast/entradas-route.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canEditForecast: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({ updateForecastEntry: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { updateForecastEntry } from '@/lib/forecast/engine'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }
const VALID_BODY = { versionId: '00000000-0000-0000-0000-000000000002', ano: 2026, mes: 8, receita: 1500 }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/forecast/entradas', { method: 'POST', body: JSON.stringify(body) })
}

function mockAdmin() {
  const auditInsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') return { insert: auditInsert }
    throw new Error(`unexpected table ${table}`)
  })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { auditInsert }
}

describe('POST /api/forecast/entradas', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when the member lacks canEditForecast', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canEditForecast).mockReturnValue(false)

    const { POST } = await import('@/app/api/forecast/entradas/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)

    const { POST } = await import('@/app/api/forecast/entradas/route')
    const response = await POST(buildRequest({ ...VALID_BODY, mes: 13 }))

    expect(response.status).toBe(400)
  })

  it('returns 400 when updateForecastEntry rejects a non-current version', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)
    vi.mocked(updateForecastEntry).mockRejectedValue(new Error('Só é possível editar a versão mais recente do forecast'))

    const { POST } = await import('@/app/api/forecast/entradas/route')
    const response = await POST(buildRequest(VALID_BODY))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Só é possível editar a versão mais recente do forecast')
  })

  it('updates the entry, writes an audit log with cenario/comentario, and returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canEditForecast).mockReturnValue(true)
    vi.mocked(updateForecastEntry).mockResolvedValue(undefined)
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/entradas/route')
    const response = await POST(buildRequest({ ...VALID_BODY, cenario: 'Base', comentario: 'Ajuste de vendas' }))
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(updateForecastEntry).toHaveBeenCalledWith(ORG_ID, VALID_BODY.versionId, 2026, 8, 1500, 'profile-1')
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'forecast_entry_updated',
        after: { receita: 1500, cenario: 'Base', comentario: 'Ajuste de vendas' },
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/forecast/entradas-route.test.ts`
Expected: FAIL — `app/api/forecast/entradas/route.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `app/api/forecast/entradas/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { updateForecastEntrySchema } from '@/lib/validation/forecast'
import { updateForecastEntry } from '@/lib/forecast/engine'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canEditForecast(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = updateForecastEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const input = parsed.data

  try {
    await updateForecastEntry(member.orgId, input.versionId, input.ano, input.mes, input.receita, member.profileId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao salvar' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'forecast_entry_updated',
    entity: 'forecast_entries',
    entity_id: `${input.versionId}-${input.ano}-${input.mes}`,
    after: { receita: input.receita, cenario: input.cenario ?? null, comentario: input.comentario ?? null },
  })
  if (auditError) {
    console.error('Failed to write audit_logs for forecast_entry_updated:', auditError.message)
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/forecast/entradas-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/forecast/entradas/route.ts tests/unit/forecast/entradas-route.test.ts
git commit -m "feat: add POST /api/forecast/entradas"
```

---

### Task 10: API route — `POST /api/forecast/cenarios`

**Files:**
- Create: `app/api/forecast/cenarios/route.ts`
- Test: `tests/unit/forecast/cenarios-route.test.ts`

**Interfaces:**
- Consumes: `canCreateScenario` from `lib/auth/rbac.ts`; `createForecastScenarioSchema` from `lib/validation/forecast.ts` (Task 5); `createForecastScenario` from `lib/forecast/engine.ts` (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/forecast/cenarios-route.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canCreateScenario: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({ createForecastScenario: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { createForecastScenario } from '@/lib/forecast/engine'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/forecast/cenarios', { method: 'POST', body: JSON.stringify(body) })
}

function mockAdmin() {
  const auditInsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') return { insert: auditInsert }
    throw new Error(`unexpected table ${table}`)
  })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { auditInsert }
}

describe('POST /api/forecast/cenarios', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when the member lacks canCreateScenario', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canCreateScenario).mockReturnValue(false)

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: 'Pessimista' }))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: '' }))

    expect(response.status).toBe(400)
  })

  it('creates the scenario, logs forecast_scenario_created when not duplicating, and returns it', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(createForecastScenario).mockResolvedValue({
      id: 's-2',
      name: 'Pessimista',
      createdAt: '2026-08-01T00:00:00Z',
    })
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    const response = await POST(buildRequest({ name: 'Pessimista' }))
    const body = await response.json()

    expect(body).toEqual({ ok: true, scenario: { id: 's-2', name: 'Pessimista', createdAt: '2026-08-01T00:00:00Z' } })
    expect(createForecastScenario).toHaveBeenCalledWith(ORG_ID, 'Pessimista', 'profile-1', undefined)
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'forecast_scenario_created' }))
  })

  it('logs forecast_scenario_duplicated when duplicateFromScenarioId is given', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(createForecastScenario).mockResolvedValue({
      id: 's-3',
      name: 'Conservador (cópia)',
      createdAt: '2026-08-01T00:00:00Z',
    })
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/cenarios/route')
    await POST(buildRequest({ name: 'Conservador (cópia)', duplicateFromScenarioId: 's-1' }))

    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({ action: 'forecast_scenario_duplicated' }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/forecast/cenarios-route.test.ts`
Expected: FAIL — `app/api/forecast/cenarios/route.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `app/api/forecast/cenarios/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createForecastScenarioSchema } from '@/lib/validation/forecast'
import { createForecastScenario } from '@/lib/forecast/engine'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canCreateScenario(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = createForecastScenarioSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const input = parsed.data

  let scenario
  try {
    scenario = await createForecastScenario(member.orgId, input.name, member.profileId, input.duplicateFromScenarioId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao criar cenário' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: input.duplicateFromScenarioId ? 'forecast_scenario_duplicated' : 'forecast_scenario_created',
    entity: 'forecast_scenarios',
    entity_id: scenario.id,
    after: { name: scenario.name, duplicateFromScenarioId: input.duplicateFromScenarioId ?? null },
  })
  if (auditError) {
    console.error('Failed to write audit_logs for forecast_scenario_created:', auditError.message)
  }

  return NextResponse.json({ ok: true, scenario })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/forecast/cenarios-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/forecast/cenarios/route.ts tests/unit/forecast/cenarios-route.test.ts
git commit -m "feat: add POST /api/forecast/cenarios"
```

---

### Task 11: API route — `POST /api/forecast/cenarios/multiplicadores`

**Files:**
- Create: `app/api/forecast/cenarios/multiplicadores/route.ts`
- Test: `tests/unit/forecast/multiplicadores-route.test.ts`

**Interfaces:**
- Consumes: `canCreateScenario` from `lib/auth/rbac.ts`; `updateScenarioMultiplierSchema` from `lib/validation/forecast.ts` (Task 5); `updateScenarioMultiplier` from `lib/forecast/engine.ts` (Task 7).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/forecast/multiplicadores-route.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/auth/session', () => ({ getCurrentMember: vi.fn() }))
vi.mock('@/lib/auth/rbac', () => ({ canCreateScenario: vi.fn() }))
vi.mock('@/lib/forecast/engine', () => ({ updateScenarioMultiplier: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { updateScenarioMultiplier } from '@/lib/forecast/engine'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const MEMBER = { orgId: ORG_ID, profileId: 'profile-1', role: 'MANAGER' as const }
const VALID_BODY = { scenarioId: '00000000-0000-0000-0000-000000000004', ano: 2026, mes: 8, percentual: 90 }

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/forecast/cenarios/multiplicadores', { method: 'POST', body: JSON.stringify(body) })
}

function mockAdmin() {
  const auditInsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
    if (table === 'audit_logs') return { insert: auditInsert }
    throw new Error(`unexpected table ${table}`)
  })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ from } as never)
  return { auditInsert }
}

describe('POST /api/forecast/cenarios/multiplicadores', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns 403 when the member lacks canCreateScenario', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue({ ...MEMBER, role: 'VIEWER' } as never)
    vi.mocked(canCreateScenario).mockReturnValue(false)

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(403)
  })

  it('returns 400 on an invalid body', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest({ ...VALID_BODY, percentual: -5 }))

    expect(response.status).toBe(400)
  })

  it('returns 400 when updateScenarioMultiplier rejects a foreign scenario', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(updateScenarioMultiplier).mockRejectedValue(new Error('Cenário não encontrado'))

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest(VALID_BODY))

    expect(response.status).toBe(400)
  })

  it('updates the multiplier, writes an audit log, and returns ok', async () => {
    vi.mocked(getCurrentMember).mockResolvedValue(MEMBER as never)
    vi.mocked(canCreateScenario).mockReturnValue(true)
    vi.mocked(updateScenarioMultiplier).mockResolvedValue(undefined)
    const { auditInsert } = mockAdmin()

    const { POST } = await import('@/app/api/forecast/cenarios/multiplicadores/route')
    const response = await POST(buildRequest(VALID_BODY))
    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(updateScenarioMultiplier).toHaveBeenCalledWith(ORG_ID, VALID_BODY.scenarioId, 2026, 8, 90)
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'forecast_scenario_multiplier_updated' })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/forecast/multiplicadores-route.test.ts`
Expected: FAIL — the route doesn't exist yet.

- [ ] **Step 3: Implement**

Create `app/api/forecast/cenarios/multiplicadores/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { updateScenarioMultiplierSchema } from '@/lib/validation/forecast'
import { updateScenarioMultiplier } from '@/lib/forecast/engine'

export async function POST(request: Request) {
  const member = await getCurrentMember()

  if (!member || !canCreateScenario(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = updateScenarioMultiplierSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos' }, { status: 400 })
  }
  const input = parsed.data

  try {
    await updateScenarioMultiplier(member.orgId, input.scenarioId, input.ano, input.mes, input.percentual)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Falha ao salvar' }, { status: 400 })
  }

  const admin = createAdminSupabaseClient()
  const { error: auditError } = await admin.from('audit_logs').insert({
    org_id: member.orgId,
    actor_profile_id: member.profileId,
    action: 'forecast_scenario_multiplier_updated',
    entity: 'forecast_scenario_multipliers',
    entity_id: `${input.scenarioId}-${input.ano}-${input.mes}`,
    after: { percentual: input.percentual },
  })
  if (auditError) {
    console.error('Failed to write audit_logs for forecast_scenario_multiplier_updated:', auditError.message)
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/forecast/multiplicadores-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/forecast/cenarios/multiplicadores/route.ts tests/unit/forecast/multiplicadores-route.test.ts
git commit -m "feat: add POST /api/forecast/cenarios/multiplicadores"
```

---

### Task 12: Planejamento — grid, version selector, new-version form

**Files:**
- Create: `components/forecast/planning-grid.tsx`
- Create: `components/forecast/new-version-form.tsx`
- Modify: `app/(app)/planejamento/page.tsx`
- Test: `tests/unit/components/planning-grid.test.tsx`
- Test: `tests/unit/components/new-version-form.test.tsx`

**Interfaces:**
- Consumes: `MonthlyValue` from `lib/forecast/scenarios.ts` (Task 3); `loadAllVersions`, `loadVersionEntries` from `lib/forecast/engine.ts` (Tasks 6-7); `canEditForecast` from `lib/auth/rbac.ts`; `POST /api/forecast/entradas` (Task 9), `POST /api/forecast/versoes` (Task 8).

- [ ] **Step 1: Write the failing component tests**

Create `tests/unit/components/planning-grid.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { PlanningGrid } from '@/components/forecast/planning-grid'

describe('PlanningGrid', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows read-only values when canEdit is false', () => {
    render(
      <PlanningGrid versionId="v-1" entries={[{ ano: 2026, mes: 8, value: 1000 }]} canEdit={false} />
    )

    expect(screen.getByText('2026')).toBeTruthy()
    expect(screen.queryByLabelText('Ago 2026')).toBeNull()
  })

  it('posts the edited cell to /api/forecast/entradas on blur when canEdit is true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlanningGrid versionId="v-1" entries={[{ ano: 2026, mes: 8, value: 1000 }]} canEdit={true} />
    )

    fireEvent.change(screen.getByLabelText('Ago 2026'), { target: { value: '1500' } })
    fireEvent.blur(screen.getByLabelText('Ago 2026'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/forecast/entradas',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ versionId: 'v-1', ano: 2026, mes: 8, receita: 1500 }),
        })
      )
    )
  })

  it('shows the returned error message when the save fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Não autorizado' }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlanningGrid versionId="v-1" entries={[{ ano: 2026, mes: 8, value: 1000 }]} canEdit={true} />)

    fireEvent.change(screen.getByLabelText('Ago 2026'), { target: { value: '1500' } })
    fireEvent.blur(screen.getByLabelText('Ago 2026'))

    await waitFor(() => expect(screen.getByText('Não autorizado')).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/components/planning-grid.test.tsx`
Expected: FAIL — `components/forecast/planning-grid.tsx` doesn't exist yet.

- [ ] **Step 3: Implement `PlanningGrid`**

Create `components/forecast/planning-grid.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatBRL } from '@/lib/format/currency'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

const MONTH_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function monthKey(ano: number, mes: number): string {
  return `${ano}-${mes}`
}

export function PlanningGrid({
  versionId,
  entries,
  canEdit,
}: {
  versionId: string
  entries: MonthlyValue[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [values, setValues] = useState(() => {
    const map = new Map<string, number>()
    for (const entry of entries) map.set(monthKey(entry.ano, entry.mes), entry.value)
    return map
  })
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const years = Array.from(new Set(entries.map((e) => e.ano))).sort((a, b) => a - b)

  async function handleBlur(ano: number, mes: number, raw: string) {
    const receita = Number(raw)
    if (Number.isNaN(receita)) return
    const key = monthKey(ano, mes)
    if (values.get(key) === receita) return

    setPendingKey(key)
    setError(null)
    try {
      const response = await fetch('/api/forecast/entradas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId, ano, mes, receita }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao salvar')
      } else {
        setValues((prev) => new Map(prev).set(key, receita))
        router.refresh()
      }
    } catch {
      setError('Falha ao salvar')
    } finally {
      setPendingKey(null)
    }
  }

  if (years.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum mês planejado ainda nesta versão.</p>
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 font-medium">Ano</th>
              {MONTH_LABEL.map((label) => (
                <th key={label} className="px-3 py-2 text-right font-medium">
                  {label}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {years.map((ano) => {
              const rowValues = MONTH_LABEL.map((_, i) => values.get(monthKey(ano, i + 1)))
              const total = rowValues.reduce((sum: number, v) => sum + (v ?? 0), 0)
              return (
                <tr key={ano} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{ano}</td>
                  {rowValues.map((value, i) => {
                    const mes = i + 1
                    const key = monthKey(ano, mes)
                    if (value === undefined) {
                      return (
                        <td key={key} className="px-3 py-2 text-right text-neutral-300">
                          —
                        </td>
                      )
                    }
                    return (
                      <td key={key} className="px-2 py-1 text-right">
                        {canEdit ? (
                          <input
                            aria-label={`${MONTH_LABEL[i]} ${ano}`}
                            type="number"
                            step="0.01"
                            defaultValue={value}
                            disabled={pendingKey === key}
                            onBlur={(e) => handleBlur(ano, mes, e.target.value)}
                            className="w-24 rounded border px-1 py-1 text-right text-sm"
                          />
                        ) : (
                          formatBRL(value)
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-medium">{formatBRL(total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run the grid tests to verify they pass**

Run: `npx vitest run tests/unit/components/planning-grid.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing new-version-form test**

Create `tests/unit/components/new-version-form.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { NewVersionForm } from '@/components/forecast/new-version-form'

describe('NewVersionForm', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts the entered name to /api/forecast/versoes and shows the error message on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Não autorizado' }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewVersionForm />)
    fireEvent.change(screen.getByLabelText('Nome da nova versão'), { target: { value: 'Forecast Setembro 2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar versão' }))

    await waitFor(() => expect(screen.getByText('Não autorizado')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/forecast/versoes',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Forecast Setembro 2026' }) })
    )
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/new-version-form.test.tsx`
Expected: FAIL — `components/forecast/new-version-form.tsx` doesn't exist yet.

- [ ] **Step 7: Implement `NewVersionForm`**

Create `components/forecast/new-version-form.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function NewVersionForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/forecast/versoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao criar versão')
      } else {
        setName('')
        router.refresh()
      }
    } catch {
      setError('Falha ao criar versão')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="new-version-name" className="text-xs font-medium text-neutral-600">
          Nome da nova versão
        </label>
        <input
          id="new-version-name"
          aria-label="Nome da nova versão"
          type="text"
          required
          placeholder="Ex.: Forecast Setembro 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Criar versão
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/new-version-form.test.tsx`
Expected: PASS

- [ ] **Step 9: Replace the `EmptyState` in the Planejamento page**

Replace `app/(app)/planejamento/page.tsx`:

```typescript
import Link from 'next/link'
import { getCurrentMember } from '@/lib/auth/session'
import { canEditForecast } from '@/lib/auth/rbac'
import { loadAllVersions, loadVersionEntries } from '@/lib/forecast/engine'
import { PlanningGrid } from '@/components/forecast/planning-grid'
import { NewVersionForm } from '@/components/forecast/new-version-form'

export default async function PlanejamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ versao?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o planejamento.</p>
  }

  const versions = await loadAllVersions(member.orgId)
  if (versions.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhuma versão de forecast cadastrada ainda.</p>
  }

  const { versao } = await searchParams
  const selected = versions.find((v) => v.id === versao) ?? versions[0]
  const isCurrent = selected.id === versions[0].id
  const entries = await loadVersionEntries(member.orgId, selected.id)
  const canEdit = canEditForecast(member.role)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Planejamento de Receita</h1>
        <Link href="/planejamento/forecast-vs-realizado" className="text-sm text-neutral-600 underline">
          Forecast vs Realizado
        </Link>
      </div>
      <form className="flex items-center gap-2">
        <label htmlFor="versao" className="text-sm text-neutral-600">
          Versão
        </label>
        <select id="versao" name="versao" defaultValue={selected.id} className="rounded border px-2 py-1 text-sm">
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.id === versions[0].id ? ' (atual)' : ''}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
          Ver
        </button>
      </form>
      {canEdit && <NewVersionForm />}
      <PlanningGrid versionId={selected.id} entries={entries} canEdit={canEdit && isCurrent} />
    </div>
  )
}
```

- [ ] **Step 10: Run the full unit suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add components/forecast/planning-grid.tsx components/forecast/new-version-form.tsx "app/(app)/planejamento/page.tsx" tests/unit/components/planning-grid.test.tsx tests/unit/components/new-version-form.test.tsx
git commit -m "feat: replace the Planejamento placeholder with the editable revenue grid and version selector"
```

---

### Task 13: Cenários — multiplier grid, new/duplicate form

**Files:**
- Create: `components/forecast/scenario-multiplier-grid.tsx`
- Create: `components/forecast/new-scenario-form.tsx`
- Modify: `app/(app)/cenarios/page.tsx`
- Test: `tests/unit/components/scenario-multiplier-grid.test.tsx`
- Test: `tests/unit/components/new-scenario-form.test.tsx`

**Interfaces:**
- Consumes: `MonthlyValue` from `lib/forecast/scenarios.ts` (Task 3); `loadScenarios` from `lib/forecast/engine.ts` (Task 6); `canCreateScenario` from `lib/auth/rbac.ts`; `POST /api/forecast/cenarios` (Task 10), `POST /api/forecast/cenarios/multiplicadores` (Task 11).

- [ ] **Step 1: Write the failing grid test**

Create `tests/unit/components/scenario-multiplier-grid.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ScenarioMultiplierGrid } from '@/components/forecast/scenario-multiplier-grid'

describe('ScenarioMultiplierGrid', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts the edited percentual to /api/forecast/cenarios/multiplicadores on blur', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<ScenarioMultiplierGrid scenarioId="s-1" multipliers={[{ ano: 2026, mes: 8, value: 85 }]} canEdit={true} />)

    fireEvent.change(screen.getByLabelText('Ago 2026 %'), { target: { value: '90' } })
    fireEvent.blur(screen.getByLabelText('Ago 2026 %'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/forecast/cenarios/multiplicadores',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ scenarioId: 's-1', ano: 2026, mes: 8, percentual: 90 }),
        })
      )
    )
  })

  it('shows read-only percentuals when canEdit is false', () => {
    render(<ScenarioMultiplierGrid scenarioId="s-1" multipliers={[{ ano: 2026, mes: 8, value: 85 }]} canEdit={false} />)

    expect(screen.getByText('85%')).toBeTruthy()
    expect(screen.queryByLabelText('Ago 2026 %')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/scenario-multiplier-grid.test.tsx`
Expected: FAIL — `components/forecast/scenario-multiplier-grid.tsx` doesn't exist yet.

- [ ] **Step 3: Implement `ScenarioMultiplierGrid`**

Create `components/forecast/scenario-multiplier-grid.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MonthlyValue } from '@/lib/forecast/scenarios'

const MONTH_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function monthKey(ano: number, mes: number): string {
  return `${ano}-${mes}`
}

export function ScenarioMultiplierGrid({
  scenarioId,
  multipliers,
  canEdit,
}: {
  scenarioId: string
  multipliers: MonthlyValue[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [values, setValues] = useState(() => {
    const map = new Map<string, number>()
    for (const m of multipliers) map.set(monthKey(m.ano, m.mes), m.value)
    return map
  })
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const years = Array.from(new Set(multipliers.map((m) => m.ano))).sort((a, b) => a - b)

  async function handleBlur(ano: number, mes: number, raw: string) {
    const percentual = Number(raw)
    if (Number.isNaN(percentual)) return
    const key = monthKey(ano, mes)
    if (values.get(key) === percentual) return

    setPendingKey(key)
    setError(null)
    try {
      const response = await fetch('/api/forecast/cenarios/multiplicadores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId, ano, mes, percentual }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao salvar')
      } else {
        setValues((prev) => new Map(prev).set(key, percentual))
        router.refresh()
      }
    } catch {
      setError('Falha ao salvar')
    } finally {
      setPendingKey(null)
    }
  }

  if (years.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhum multiplicador cadastrado ainda.</p>
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 font-medium">Ano</th>
              {MONTH_LABEL.map((label) => (
                <th key={label} className="px-3 py-2 text-right font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((ano) => (
              <tr key={ano} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{ano}</td>
                {MONTH_LABEL.map((_, i) => {
                  const mes = i + 1
                  const key = monthKey(ano, mes)
                  const value = values.get(key)
                  if (value === undefined) {
                    return (
                      <td key={key} className="px-3 py-2 text-right text-neutral-300">
                        —
                      </td>
                    )
                  }
                  return (
                    <td key={key} className="px-2 py-1 text-right">
                      {canEdit ? (
                        <input
                          aria-label={`${MONTH_LABEL[i]} ${ano} %`}
                          type="number"
                          step="1"
                          defaultValue={value}
                          disabled={pendingKey === key}
                          onBlur={(e) => handleBlur(ano, mes, e.target.value)}
                          className="w-16 rounded border px-1 py-1 text-right text-sm"
                        />
                      ) : (
                        `${value}%`
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run the grid tests to verify they pass**

Run: `npx vitest run tests/unit/components/scenario-multiplier-grid.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing new-scenario-form test**

Create `tests/unit/components/new-scenario-form.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { NewScenarioForm } from '@/components/forecast/new-scenario-form'

describe('NewScenarioForm', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts name and duplicateFromScenarioId to /api/forecast/cenarios', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewScenarioForm scenarios={[{ id: 's-1', name: 'Conservador' }]} />)
    fireEvent.change(screen.getByLabelText('Nome do cenário'), { target: { value: 'Conservador (cópia)' } })
    fireEvent.change(screen.getByLabelText('Duplicar de'), { target: { value: 's-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/forecast/cenarios',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Conservador (cópia)', duplicateFromScenarioId: 's-1' }),
        })
      )
    )
  })

  it('shows the returned error message when the request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Não autorizado' }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewScenarioForm scenarios={[]} />)
    fireEvent.change(screen.getByLabelText('Nome do cenário'), { target: { value: 'Pessimista' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }))

    await waitFor(() => expect(screen.getByText('Não autorizado')).toBeTruthy())
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/unit/components/new-scenario-form.test.tsx`
Expected: FAIL — `components/forecast/new-scenario-form.tsx` doesn't exist yet.

- [ ] **Step 7: Implement `NewScenarioForm`**

Create `components/forecast/new-scenario-form.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function NewScenarioForm({ scenarios }: { scenarios: Array<{ id: string; name: string }> }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [duplicateFrom, setDuplicateFrom] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/forecast/cenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, duplicateFromScenarioId: duplicateFrom || undefined }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao criar cenário')
      } else {
        setName('')
        setDuplicateFrom('')
        router.refresh()
      }
    } catch {
      setError('Falha ao criar cenário')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="new-scenario-name" className="text-xs font-medium text-neutral-600">
          Nome do cenário
        </label>
        <input
          id="new-scenario-name"
          aria-label="Nome do cenário"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="duplicate-from" className="text-xs font-medium text-neutral-600">
          Duplicar de
        </label>
        <select
          id="duplicate-from"
          aria-label="Duplicar de"
          value={duplicateFrom}
          onChange={(e) => setDuplicateFrom(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="">Nenhum (multiplicadores em branco)</option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Criar
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/unit/components/new-scenario-form.test.tsx`
Expected: PASS

- [ ] **Step 9: Replace the `EmptyState` in the Cenários page**

Replace `app/(app)/cenarios/page.tsx`:

```typescript
import { getCurrentMember } from '@/lib/auth/session'
import { canCreateScenario } from '@/lib/auth/rbac'
import { loadScenarios } from '@/lib/forecast/engine'
import { ScenarioMultiplierGrid } from '@/components/forecast/scenario-multiplier-grid'
import { NewScenarioForm } from '@/components/forecast/new-scenario-form'

export default async function CenariosPage() {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver os cenários.</p>
  }

  const scenarios = await loadScenarios(member.orgId)
  const canEdit = canCreateScenario(member.role)

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Cenários</h1>
      {canEdit && <NewScenarioForm scenarios={scenarios.map(({ scenario }) => ({ id: scenario.id, name: scenario.name }))} />}
      {scenarios.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhum cenário cadastrado ainda.</p>
      ) : (
        scenarios.map(({ scenario, multipliers }) => (
          <div key={scenario.id} className="space-y-2">
            <h2 className="text-lg font-medium">{scenario.name}</h2>
            <ScenarioMultiplierGrid scenarioId={scenario.id} multipliers={multipliers} canEdit={canEdit} />
          </div>
        ))
      )}
    </div>
  )
}
```

- [ ] **Step 10: Run the full unit suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add components/forecast/scenario-multiplier-grid.tsx components/forecast/new-scenario-form.tsx "app/(app)/cenarios/page.tsx" tests/unit/components/scenario-multiplier-grid.test.tsx tests/unit/components/new-scenario-form.test.tsx
git commit -m "feat: replace the Cenários placeholder with the multiplier grid and new/duplicate form"
```

---

### Task 14: Forecast vs Realizado report

**Files:**
- Create: `app/(app)/planejamento/forecast-vs-realizado/page.tsx`

**Interfaces:**
- Consumes: `loadAllVersions`, `loadVersionEntries`, `loadRealizadoByMonth` from `lib/forecast/engine.ts` (Tasks 6-7); `compareForecastToActual` from `lib/forecast/compare.ts` (Task 4); `toLocalDateParam` from `lib/integrations/date.ts`; `formatBRL` from `lib/format/currency.ts`.

This page has no new pure logic of its own (it composes Tasks 4 and 6), so it is covered by the Task 15 integration test rather than a dedicated unit test — consistent with how `app/(app)/fluxo-de-caixa/anual/page.tsx` (Fase 5) has no page-level unit test either.

- [ ] **Step 1: Create the page**

Create `app/(app)/planejamento/forecast-vs-realizado/page.tsx`:

```typescript
import { getCurrentMember } from '@/lib/auth/session'
import { loadAllVersions, loadVersionEntries, loadRealizadoByMonth } from '@/lib/forecast/engine'
import { compareForecastToActual } from '@/lib/forecast/compare'
import { toLocalDateParam } from '@/lib/integrations/date'
import { formatBRL } from '@/lib/format/currency'

export default async function ForecastVsRealizadoPage({
  searchParams,
}: {
  searchParams: Promise<{ versao?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) {
    return <p className="text-sm text-neutral-500">Faça login para ver o relatório.</p>
  }

  const versions = await loadAllVersions(member.orgId)
  if (versions.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhuma versão de forecast cadastrada ainda.</p>
  }

  const { versao } = await searchParams
  const which = versao === 'original' ? 'original' : 'atual'
  const selectedVersion = which === 'original' ? versions[versions.length - 1] : versions[0]

  const [entries, realizadoSums] = await Promise.all([
    loadVersionEntries(member.orgId, selectedVersion.id),
    loadRealizadoByMonth(member.orgId),
  ])

  const today = toLocalDateParam(new Date())
  const [todayAno, todayMes] = today.slice(0, 7).split('-').map(Number)

  const rows = compareForecastToActual(entries, realizadoSums, { ano: todayAno, mes: todayMes })

  const ytdRows = rows.filter((r) => r.ano === todayAno && r.mes <= todayMes)
  const ytdPlanejado = ytdRows.reduce((sum, r) => sum + r.planejado, 0)
  const ytdHasAllRealizado = ytdRows.every((r) => r.realizado !== null)
  const ytdRealizado = ytdHasAllRealizado ? ytdRows.reduce((sum, r) => sum + (r.realizado ?? 0), 0) : null
  const ytdDiferenca = ytdRealizado != null ? ytdRealizado - ytdPlanejado : null
  const ytdDiferencaPercentual = ytdDiferenca != null && ytdPlanejado !== 0 ? ytdDiferenca / ytdPlanejado : null

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Forecast vs Realizado</h1>
      <form className="flex items-center gap-2">
        <label htmlFor="versao" className="text-sm text-neutral-600">
          Comparar
        </label>
        <select id="versao" name="versao" defaultValue={which} className="rounded border px-2 py-1 text-sm">
          <option value="atual">Forecast atual ({versions[0].name})</option>
          <option value="original">Forecast original ({versions[versions.length - 1].name})</option>
        </select>
        <button type="submit" className="rounded border px-3 py-1 text-sm font-medium">
          Ver
        </button>
      </form>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-3 py-2 font-medium">Mês</th>
              <th className="px-3 py-2 text-right font-medium">Planejado</th>
              <th className="px-3 py-2 text-right font-medium">Realizado</th>
              <th className="px-3 py-2 text-right font-medium">Diferença R$</th>
              <th className="px-3 py-2 text-right font-medium">Diferença %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.ano}-${row.mes}`} className="border-b last:border-0">
                <td className="px-3 py-2">
                  {String(row.mes).padStart(2, '0')}/{row.ano}
                </td>
                <td className="px-3 py-2 text-right">{formatBRL(row.planejado)}</td>
                <td className="px-3 py-2 text-right">{row.realizado != null ? formatBRL(row.realizado) : '—'}</td>
                <td
                  className={`px-3 py-2 text-right ${
                    row.diferencaAbsoluta != null && row.diferencaAbsoluta < 0 ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  {row.diferencaAbsoluta != null ? formatBRL(row.diferencaAbsoluta) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.diferencaPercentual != null ? `${(row.diferencaPercentual * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-neutral-50 font-medium">
            <tr>
              <td className="px-3 py-2">YTD {todayAno}</td>
              <td className="px-3 py-2 text-right">{formatBRL(ytdPlanejado)}</td>
              <td className="px-3 py-2 text-right">{ytdRealizado != null ? formatBRL(ytdRealizado) : '—'}</td>
              <td className="px-3 py-2 text-right">{ytdDiferenca != null ? formatBRL(ytdDiferenca) : '—'}</td>
              <td className="px-3 py-2 text-right">
                {ytdDiferencaPercentual != null ? `${(ytdDiferencaPercentual * 100).toFixed(1)}%` : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/planejamento/forecast-vs-realizado/page.tsx"
git commit -m "feat: add the Forecast vs Realizado report"
```

---

### Task 15: Integration test, docs, and final verification

**Files:**
- Create: `tests/integration/forecast.test.ts`
- Modify: `docs/data-model.md`
- Modify: `docs/financial-rules.md`
- Modify: `docs/decisions.md`
- Modify: `docs/assumptions.md`

**Interfaces:**
- Consumes: `loadAllVersions`, `loadVersionEntries`, `createForecastVersion`, `updateForecastEntry`, `createForecastScenario`, `loadScenarios`, `loadRealizadoByMonth` from `@/lib/forecast/engine`; `applyScenario` from `@/lib/forecast/scenarios`; `compareForecastToActual` from `@/lib/forecast/compare`. Same real-local-Supabase pattern as `tests/integration/cash-flow.test.ts`.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/forecast.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceKey)

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const FIXTURE_PREFIX = 'INTEGRATION-TEST-FORECAST'

async function cleanupFixtures(): Promise<void> {
  const { data: versions } = await admin.from('forecast_versions').select('id').eq('org_id', ORG_ID).like('name', `${FIXTURE_PREFIX}%`)
  for (const v of versions ?? []) {
    await admin.from('forecast_entries').delete().eq('version_id', v.id)
  }
  await admin.from('forecast_versions').delete().eq('org_id', ORG_ID).like('name', `${FIXTURE_PREFIX}%`)

  const { data: scenarios } = await admin.from('forecast_scenarios').select('id').eq('org_id', ORG_ID).like('name', `${FIXTURE_PREFIX}%`)
  for (const s of scenarios ?? []) {
    await admin.from('forecast_scenario_multipliers').delete().eq('scenario_id', s.id)
  }
  await admin.from('forecast_scenarios').delete().eq('org_id', ORG_ID).like('name', `${FIXTURE_PREFIX}%`)
}

async function seedProfileId(): Promise<string | null> {
  const { data } = await admin.from('organization_members').select('profile_id').eq('org_id', ORG_ID).limit(1).maybeSingle()
  return (data?.profile_id as string | undefined) ?? null
}

describe('forecast engine — real database integration', () => {
  beforeEach(cleanupFixtures)
  afterEach(cleanupFixtures)

  it('creates a version, edits an entry, applies a scenario, and compares against real olist_orders', async () => {
    const profileId = await seedProfileId()
    if (!profileId) {
      // No local profile to attribute a version/entry to on a fresh,
      // unseeded local instance — see the same accepted degradation
      // pattern in tests/integration/cash-flow.test.ts.
      return
    }

    const { loadAllVersions, loadVersionEntries, createForecastVersion, updateForecastEntry, createForecastScenario, loadScenarios, loadRealizadoByMonth } =
      await import('@/lib/forecast/engine')
    const { applyScenario } = await import('@/lib/forecast/scenarios')
    const { compareForecastToActual } = await import('@/lib/forecast/compare')

    const version = await createForecastVersion(ORG_ID, `${FIXTURE_PREFIX}-versao`, profileId)
    await updateForecastEntry(ORG_ID, version.id, 2026, 8, 10000, profileId)

    const entries = await loadVersionEntries(ORG_ID, version.id)
    expect(entries).toEqual(expect.arrayContaining([{ ano: 2026, mes: 8, value: 10000 }]))

    const versions = await loadAllVersions(ORG_ID)
    expect(versions[0].id).toBe(version.id)

    const scenario = await createForecastScenario(ORG_ID, `${FIXTURE_PREFIX}-cenario`, profileId)
    const scenarios = await loadScenarios(ORG_ID)
    const created = scenarios.find((s) => s.scenario.id === scenario.id)
    expect(created?.multipliers).toEqual([])
    expect(applyScenario(entries, created?.multipliers ?? [])).toEqual(
      expect.arrayContaining([{ ano: 2026, mes: 8, value: 10000 }]) // no multiplier row => 100%
    )

    const realizadoSums = await loadRealizadoByMonth(ORG_ID)
    const rows = compareForecastToActual(entries, realizadoSums, { ano: 2026, mes: 8 })
    const row = rows.find((r) => r.ano === 2026 && r.mes === 8)
    expect(row?.planejado).toBe(10000)
  })
})
```

- [ ] **Step 2: Run it against local Supabase**

Ensure local Supabase is running (`npx supabase status`). Run: `npm run test:integration`
Expected: PASS. If skipped due to no seeded profile, note that explicitly — same accepted degradation as Fase 4/5's integration tests.

- [ ] **Step 3: Confirm the rest of the suite is unaffected**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Update `docs/data-model.md`**

Add a "Tabelas da Fase 6 (parte B — planejamento de receita)" section documenting `forecast_versions`, `forecast_entries`, `forecast_scenarios`, `forecast_scenario_multipliers` (columns, RLS pattern, nullable `created_by`/`updated_by` and why), matching the style of the existing "Tabelas da Fase 5" section.

- [ ] **Step 5: Update `docs/financial-rules.md`**

Add a "Fase 6 (parte B): planejamento de receita" section: the current-version rule (most recent `created_at` is the only editable one), the scenario-as-multiplier rule (`forecast_entries.receita × percentual / 100`, missing multiplier = 100%), and the Forecast vs Realizado realizado/null/zero rule (past month with no orders = confirmed 0; current or future month with no orders = null/"—") — condensed from the spec's equivalent sections.

- [ ] **Step 6: Update `docs/decisions.md`**

Add:

```markdown
## ADR-007: Forecast vs Realizado usa faturamento (olist_orders), não caixa recebido
Contexto: a Fase 5 já expõe "caixa recebido" (AR realizado) por dia. A
pergunta do MVP (Prompt Mestre seção 55, item 9) é "quanto vendemos frente
ao planejado" — uma venda faturada e ainda não paga já é venda, mas ainda
não é caixa. Decisão: `Realizado` no relatório Forecast vs Realizado é a
soma de `olist_orders.valor_total_pedido` por mês de `data`, não o bucket
`realizado` do motor de fluxo de caixa (Fase 6B).

## ADR-008: Cenário é um multiplicador sobre uma versão, não uma cópia independente
Contexto: Prompt Mestre seção 16 permite duplicar cenários e usar
multiplicadores editáveis por mês. Decisão: um cenário nunca guarda valores
de receita — só um percentual por (ano, mês) aplicado sobre
`forecast_entries.receita` na leitura. Duplicar um cenário copia seus
multiplicadores para um novo cenário; nunca cria uma nova
`forecast_version` (Fase 6B).
```

- [ ] **Step 7: Update `docs/assumptions.md`**

Add a "Riscos conhecidos (Fase 6B — Planejamento de Receita)" section documenting: (1) `olist_orders.valor_total_pedido` is summed without filtering by `situacao` because the integer status codes observed in real data (`0, 1, 3, 4, 5, 6, 7`) have no documented mapping — Realizado in the report may include cancelled orders until this is confirmed; (2) `forecast_scenario_multipliers` with no row for a given month is treated as 100%, which can silently under-represent a scenario if a version is extended to cover months the scenario was never updated for.

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
git add tests/integration/forecast.test.ts docs/data-model.md docs/financial-rules.md docs/decisions.md docs/assumptions.md
git commit -m "test: add a real-database integration test for the forecast engine; document Fase 6B"
```

## Acceptance Checklist

- [ ] The org's most-recently-created `forecast_versions` row is the only one editable in the Planejamento grid; older versions render read-only.
- [ ] Creating a new version copies the current version's entries so revising a forecast doesn't require re-entering every month.
- [ ] A scenario is a percentual multiplier applied on read (`applyScenario`) — `forecast_entries.receita` never changes when a scenario is created, duplicated, or edited.
- [ ] Every write that accepts a foreign-key id from the client (`versionId`, `scenarioId`, `duplicateFromScenarioId`) verifies it belongs to the caller's org before reading or writing it.
- [ ] The Forecast vs Realizado report never shows a future/current month with no synced orders as `0` — it shows "—", distinct from a confirmed-zero past month.
- [ ] `Diferença %` is never computed by dividing by a zero `Planejado`.
- [ ] `canEditForecast`/`canCreateScenario` gate every write route; VIEWER can read but never write.
- [ ] `npm run test:integration` exercises the engine against a live local Postgres and passes (or explicitly notes the no-seeded-profile skip).
- [ ] `npm test`, `npm run lint`, `npx tsc --noEmit` all pass.
