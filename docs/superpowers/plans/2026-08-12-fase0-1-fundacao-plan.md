# WEE Cash Flow — Fase 0 + Fase 1 (Fundação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a working, tested Next.js + Supabase scaffold for the WEE Cash Flow platform — auth, RBAC, org data model, full navigation shell with empty states, and the Fase 0 architecture docs — with no financial data or external integrations yet.

**Architecture:** Next.js 14 App Router (TypeScript strict, Tailwind, shadcn/ui) talking only to Supabase (Postgres + Auth + RLS) server-side via `@supabase/ssr`. Single seeded organization ("WEE") with `org_id` on every table and RLS enforced from the first migration. No ORM — hand-written SQL migrations (Supabase CLI) and manually typed queries, validated at every boundary with Zod.

**Tech Stack:** Next.js 14 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui, Supabase (Postgres/Auth/RLS via Supabase CLI + `@supabase/ssr`), Zod, Vitest, Playwright, npm.

## Global Constraints

- Language of all UI copy: pt-BR. Currency format: BRL (`R$ 1.234,56`). Dates: `dd/MM/yyyy`. Timezone: `America/Sao_Paulo`.
- No cadastro público — users are invited by an OWNER_ADMIN only.
- No ORM. SQL migrations via Supabase CLI, hand-written queries, Zod validation at every boundary.
- Single organization ("WEE") seeded, but every relevant table carries `org_id` and RLS restricts by organization membership.
- No calls to Olist or SumUp APIs in this phase. No financial calculation logic in this phase.
- `.env.local` must never be committed; `.env.example` must never contain real values.
- Every route in the navigation must render (empty state is acceptable) — no 404s, no unhandled errors.
- Commit after every task.

---

### Task 1: Project scaffold (Next.js, TypeScript, Tailwind, shadcn/ui, Vitest, Playwright)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `.gitignore`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `components.json`, `vitest.config.ts`, `playwright.config.ts`
- Test: `tests/unit/smoke.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: a running `npm run dev` server on `http://localhost:3000`, `npm run build`, `npm run lint`, `npm run test` (Vitest), `npm run test:e2e` (Playwright) — every later task assumes these scripts exist.

- [ ] **Step 1: Scaffold the Next.js app**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm
```
When prompted, accept defaults. This creates `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`.

- [ ] **Step 2: Enable TypeScript strict mode**

In `tsconfig.json`, ensure `"strict": true` is set inside `"compilerOptions"` (create-next-app sets this by default — verify it's `true`, not left out).

- [ ] **Step 3: Install shadcn/ui**

Run:
```bash
npx shadcn@latest init -d
```
This creates `components.json` and a `lib/utils.ts` with the `cn()` helper. Accept the default style/base color.

- [ ] **Step 4: Install and configure Vitest**

Run:
```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

Add to `package.json` `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write and run a Vitest smoke test**

Create `tests/unit/smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `npm run test`
Expected: 1 test passes.

- [ ] **Step 6: Install and configure Playwright**

Run:
```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

Create `playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:3000' },
})
```

Add to `package.json` `"scripts"`:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 7: Write and run a Playwright smoke test**

Create `tests/e2e/smoke.spec.ts`:
```typescript
import { test, expect } from '@playwright/test'

test('home page responds', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBeLessThan(500)
})
```

Run: `npm run test:e2e`
Expected: 1 test passes.

- [ ] **Step 8: Verify build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with TypeScript, Tailwind, shadcn/ui, Vitest, Playwright"
```

---

### Task 2: Environment configuration and `.env.example`

**Files:**
- Create: `.env.example`
- Modify: `.gitignore` (verify `.env*.local` is ignored)

**Interfaces:**
- Produces: documented environment variable names (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE`, `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET`, `OLIST_REDIRECT_URI`) that Task 6 (`lib/supabase/*`) will read via `process.env`.

- [ ] **Step 1: Create `.env.example`**

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# SumUp (used starting Fase 3 — not called in this phase)
SUMUP_API_KEY=
SUMUP_MERCHANT_CODE=

# Olist (used starting Fase 2 — not called in this phase)
OLIST_CLIENT_ID=
OLIST_CLIENT_SECRET=
OLIST_REDIRECT_URI=
```

- [ ] **Step 2: Verify `.gitignore` excludes local env files**

Open `.gitignore` (created by `create-next-app`) and confirm it contains `.env*.local`. If missing, append it.

- [ ] **Step 3: Commit**

```bash
git add .env.example .gitignore
git commit -m "chore: add .env.example documenting required environment variables"
```

---

### Task 3: Format helpers (currency, date, timezone)

**Files:**
- Create: `lib/format/currency.ts`, `lib/format/date.ts`
- Test: `tests/unit/format/currency.test.ts`, `tests/unit/format/date.test.ts`

**Interfaces:**
- Produces: `formatBRL(value: number): string`, `formatDateBR(date: Date | string): string`, `WEE_TIMEZONE: 'America/Sao_Paulo'` — used by every later UI task that renders money or dates.

- [ ] **Step 1: Write failing tests for currency formatting**

Create `tests/unit/format/currency.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { formatBRL } from '@/lib/format/currency'

describe('formatBRL', () => {
  it('formats a positive integer value with thousands separator and comma decimals', () => {
    expect(formatBRL(1234.56)).toBe('R$ 1.234,56')
  })

  it('formats zero', () => {
    expect(formatBRL(0)).toBe('R$ 0,00')
  })

  it('formats negative values with a leading minus', () => {
    expect(formatBRL(-50)).toBe('-R$ 50,00')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- currency`
Expected: FAIL — `Cannot find module '@/lib/format/currency'`

- [ ] **Step 3: Implement `formatBRL`**

Create `lib/format/currency.ts`:
```typescript
const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatBRL(value: number): string {
  return brlFormatter.format(value)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- currency`
Expected: PASS (3 tests)

- [ ] **Step 5: Write failing tests for date formatting**

Create `tests/unit/format/date.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { formatDateBR, WEE_TIMEZONE } from '@/lib/format/date'

describe('formatDateBR', () => {
  it('formats a Date as dd/MM/yyyy', () => {
    expect(formatDateBR(new Date('2026-08-12T12:00:00Z'))).toBe('12/08/2026')
  })

  it('formats an ISO date string as dd/MM/yyyy', () => {
    expect(formatDateBR('2026-01-05T00:00:00Z')).toBe('05/01/2026')
  })
})

describe('WEE_TIMEZONE', () => {
  it('is America/Sao_Paulo', () => {
    expect(WEE_TIMEZONE).toBe('America/Sao_Paulo')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test -- date`
Expected: FAIL — `Cannot find module '@/lib/format/date'`

- [ ] **Step 7: Implement `formatDateBR` and `WEE_TIMEZONE`**

Create `lib/format/date.ts`:
```typescript
export const WEE_TIMEZONE = 'America/Sao_Paulo' as const

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: WEE_TIMEZONE,
})

export function formatDateBR(date: Date | string): string {
  const parsed = typeof date === 'string' ? new Date(date) : date
  return dateFormatter.format(parsed)
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -- date`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add lib/format tests/unit/format
git commit -m "feat: add BRL currency and dd/MM/yyyy date format helpers"
```

---

### Task 4: Auth validation schemas (Zod)

**Files:**
- Create: `lib/validation/auth.ts`
- Test: `tests/unit/validation/auth.test.ts`

**Interfaces:**
- Produces: `loginSchema: z.ZodType<{ email: string; password: string }>`, `inviteMemberSchema: z.ZodType<{ email: string; role: 'OWNER_ADMIN' | 'MANAGER' | 'VIEWER' }>` — consumed by the login page (Task 8) and, in a future phase, the members-invite UI.

- [ ] **Step 1: Install Zod**

Run: `npm install zod`

- [ ] **Step 2: Write failing tests**

Create `tests/unit/validation/auth.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { loginSchema, inviteMemberSchema } from '@/lib/validation/auth'

describe('loginSchema', () => {
  it('accepts a valid email and non-empty password', () => {
    const result = loginSchema.safeParse({ email: 'a@wee.com.br', password: 'senha123' })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'senha123' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'a@wee.com.br', password: '' })
    expect(result.success).toBe(false)
  })
})

describe('inviteMemberSchema', () => {
  it('accepts a valid email and role', () => {
    const result = inviteMemberSchema.safeParse({ email: 'a@wee.com.br', role: 'MANAGER' })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid role', () => {
    const result = inviteMemberSchema.safeParse({ email: 'a@wee.com.br', role: 'SUPERUSER' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- validation/auth`
Expected: FAIL — `Cannot find module '@/lib/validation/auth'`

- [ ] **Step 4: Implement the schemas**

Create `lib/validation/auth.ts`:
```typescript
import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

export const organizationRoleSchema = z.enum(['OWNER_ADMIN', 'MANAGER', 'VIEWER'])

export const inviteMemberSchema = z.object({
  email: z.string().email('E-mail inválido'),
  role: organizationRoleSchema,
})

export type LoginInput = z.infer<typeof loginSchema>
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>
export type OrganizationRole = z.infer<typeof organizationRoleSchema>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- validation/auth`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/validation tests/unit/validation
git commit -m "feat: add Zod schemas for login and member invite"
```

---

### Task 5: Supabase project setup and foundation migrations

**Files:**
- Create: `supabase/config.toml` (via CLI), `supabase/migrations/0001_foundation.sql`, `supabase/seed.sql`
- Test: manual verification via `supabase db reset` (this task has no automated test — verified in Task 13's RLS test)

**Interfaces:**
- Produces: tables `organizations`, `profiles`, `organization_members` (`role` = `OWNER_ADMIN` | `MANAGER` | `VIEWER`), `audit_logs`; SQL functions `is_org_member(uuid) returns boolean` and `current_org_role(uuid) returns organization_role`; a seeded organization row with id `00000000-0000-0000-0000-000000000001` and name `WEE`. Task 6 and Task 13 depend on this exact schema.

- [ ] **Step 1: Install Supabase CLI and initialize**

Run:
```bash
npm install -D supabase
npx supabase init
```
This creates `supabase/config.toml` and `supabase/migrations/`.

- [ ] **Step 2: Start local Supabase**

Run: `npx supabase start`
Expected: prints local API URL, anon key, service role key — note these for `.env.local` in Task 6.

- [ ] **Step 3: Write the foundation migration**

Create `supabase/migrations/0001_foundation.sql`:
```sql
create extension if not exists "pgcrypto";

create type organization_role as enum ('OWNER_ADMIN', 'MANAGER', 'VIEWER');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role organization_role not null default 'VIEWER',
  created_at timestamptz not null default now(),
  unique (org_id, profile_id)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  actor_profile_id uuid references profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index organization_members_org_id_idx on organization_members(org_id);
create index organization_members_profile_id_idx on organization_members(profile_id);
create index audit_logs_org_id_idx on audit_logs(org_id);

-- Auto-create a profile row whenever a new auth user is created.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- RLS
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table organization_members enable row level security;
alter table audit_logs enable row level security;

create or replace function is_org_member(target_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members
    where org_id = target_org_id and profile_id = auth.uid()
  );
$$;

create or replace function current_org_role(target_org_id uuid)
returns organization_role
language sql
security definer
set search_path = public
as $$
  select role from organization_members
  where org_id = target_org_id and profile_id = auth.uid()
  limit 1;
$$;

create policy "org members can read their organization"
  on organizations for select
  using (is_org_member(id));

create policy "profile owner can read own profile"
  on profiles for select
  using (id = auth.uid());

create policy "profile owner can update own profile"
  on profiles for update
  using (id = auth.uid());

create policy "members can read membership in their org"
  on organization_members for select
  using (is_org_member(org_id));

create policy "owner admins can insert membership in their org"
  on organization_members for insert
  with check (current_org_role(org_id) = 'OWNER_ADMIN');

create policy "owner admins can update membership in their org"
  on organization_members for update
  using (current_org_role(org_id) = 'OWNER_ADMIN');

create policy "owner admins can delete membership in their org"
  on organization_members for delete
  using (current_org_role(org_id) = 'OWNER_ADMIN');

create policy "members can read audit logs in their org"
  on audit_logs for select
  using (is_org_member(org_id));

create policy "members can insert audit logs in their org"
  on audit_logs for insert
  with check (is_org_member(org_id));
```

- [ ] **Step 4: Write the seed file**

Create `supabase/seed.sql`:
```sql
insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'WEE')
on conflict (id) do nothing;
```

- [ ] **Step 5: Apply migrations and seed locally**

Run: `npx supabase db reset`
Expected: migration applies with no errors, seed runs, output confirms `organizations` has 1 row (verify with `npx supabase db execute --sql "select * from organizations;"` if the CLI version supports it, otherwise inspect via Supabase Studio at the local URL printed by `supabase start`).

- [ ] **Step 6: Commit**

```bash
git add supabase
git commit -m "feat: add foundation schema migration (organizations, profiles, organization_members, audit_logs) with RLS"
```

---

### Task 6: Supabase client helpers (browser, server, middleware session refresh)

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`
- Modify: `.env.local` (not committed — set from `npx supabase start` output)

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `process.env` (Task 2).
- Produces: `createBrowserSupabaseClient(): SupabaseClient`, `createServerSupabaseClient(): Promise<SupabaseClient>`, `updateSupabaseSession(request: NextRequest): Promise<NextResponse>` — consumed by Task 7 (`lib/auth/session.ts`), Task 8 (login page), and `middleware.ts` (Task 9).

- [ ] **Step 1: Install `@supabase/ssr` and `@supabase/supabase-js`**

Run: `npm install @supabase/ssr @supabase/supabase-js`

- [ ] **Step 2: Set local env values**

Create `.env.local` (not committed) with the URL/anon key printed by `npx supabase start` in Task 5, Step 2:
```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase start output>
SUPABASE_SERVICE_ROLE_KEY=<service role key from supabase start output>
```

- [ ] **Step 3: Implement the browser client**

Create `lib/supabase/client.ts`:
```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 4: Implement the server client**

Create `lib/supabase/server.ts`:
```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component without a mutable
            // cookie store — safe to ignore because middleware refreshes
            // the session on every request.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 5: Implement the middleware session-refresh helper**

Create `lib/supabase/middleware.ts`:
```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, user }
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/supabase
git commit -m "feat: add Supabase browser/server clients and middleware session refresh helper"
```

---

### Task 7: RBAC helpers

**Files:**
- Create: `lib/auth/rbac.ts`, `lib/auth/session.ts`
- Test: `tests/unit/auth/rbac.test.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient()` from `lib/supabase/server.ts` (Task 6); `OrganizationRole` type from `lib/validation/auth.ts` (Task 4).
- Produces: `type CurrentMember = { orgId: string; profileId: string; role: OrganizationRole } | null`, `getCurrentMember(): Promise<CurrentMember>`, `canManageUsers(role: OrganizationRole): boolean`, `canManageIntegrations(role: OrganizationRole): boolean`, `canEditForecast(role: OrganizationRole): boolean`, `canCreateScenario(role: OrganizationRole): boolean` — consumed by Task 9 (app layout guard) and future-phase feature pages.

- [ ] **Step 1: Write failing tests for the pure RBAC predicates**

Create `tests/unit/auth/rbac.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import {
  canManageUsers,
  canManageIntegrations,
  canEditForecast,
  canCreateScenario,
} from '@/lib/auth/rbac'

describe('rbac predicates', () => {
  it('only OWNER_ADMIN can manage users', () => {
    expect(canManageUsers('OWNER_ADMIN')).toBe(true)
    expect(canManageUsers('MANAGER')).toBe(false)
    expect(canManageUsers('VIEWER')).toBe(false)
  })

  it('only OWNER_ADMIN can manage integrations', () => {
    expect(canManageIntegrations('OWNER_ADMIN')).toBe(true)
    expect(canManageIntegrations('MANAGER')).toBe(false)
    expect(canManageIntegrations('VIEWER')).toBe(false)
  })

  it('OWNER_ADMIN and MANAGER can edit forecast, VIEWER cannot', () => {
    expect(canEditForecast('OWNER_ADMIN')).toBe(true)
    expect(canEditForecast('MANAGER')).toBe(true)
    expect(canEditForecast('VIEWER')).toBe(false)
  })

  it('OWNER_ADMIN and MANAGER can create scenarios, VIEWER cannot', () => {
    expect(canCreateScenario('OWNER_ADMIN')).toBe(true)
    expect(canCreateScenario('MANAGER')).toBe(true)
    expect(canCreateScenario('VIEWER')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- auth/rbac`
Expected: FAIL — `Cannot find module '@/lib/auth/rbac'`

- [ ] **Step 3: Implement the RBAC predicates**

Create `lib/auth/rbac.ts`:
```typescript
import type { OrganizationRole } from '@/lib/validation/auth'

export function canManageUsers(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN'
}

export function canManageIntegrations(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN'
}

export function canEditForecast(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN' || role === 'MANAGER'
}

export function canCreateScenario(role: OrganizationRole): boolean {
  return role === 'OWNER_ADMIN' || role === 'MANAGER'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- auth/rbac`
Expected: PASS (4 tests)

- [ ] **Step 5: Implement `getCurrentMember` (no automated test — requires a live Supabase session; exercised by Task 12's e2e login test and Task 13's RLS test)**

Create `lib/auth/session.ts`:
```typescript
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { OrganizationRole } from '@/lib/validation/auth'

export type CurrentMember = {
  orgId: string
  profileId: string
  role: OrganizationRole
} | null

export async function getCurrentMember(): Promise<CurrentMember> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, profile_id, role')
    .eq('profile_id', user.id)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  return {
    orgId: data.org_id,
    profileId: data.profile_id,
    role: data.role as OrganizationRole,
  }
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add lib/auth tests/unit/auth
git commit -m "feat: add RBAC predicates and getCurrentMember session helper"
```

---

### Task 8: Login page, auth callback route, and route-protection middleware

**Files:**
- Create: `app/(auth)/login/page.tsx`, `app/auth/callback/route.ts`, `middleware.ts`
- Test: covered end-to-end in Task 12 (this task has no isolated unit test — it's UI + routing wiring)

**Interfaces:**
- Consumes: `loginSchema` (Task 4), `createBrowserSupabaseClient` (Task 6), `updateSupabaseSession` (Task 6).
- Produces: `/login` route; unauthenticated requests to any `(app)` route redirect to `/login`; authenticated requests to `/login` redirect to `/visao-geral`.

- [ ] **Step 1: Implement the root middleware**

Create `middleware.ts`:
```typescript
import { type NextRequest, NextResponse } from 'next/server'
import { updateSupabaseSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/auth/callback']

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSupabaseSession(request)
  const isPublicPath = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  )

  if (!user && !isPublicPath) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  if (user && request.nextUrl.pathname === '/login') {
    return NextResponse.redirect(new URL('/visao-geral', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 2: Implement the login page**

Create `app/(auth)/login/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { loginSchema } from '@/lib/validation/auth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const parsed = loginSchema.safeParse({ email, password })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }

    setSubmitting(true)
    const supabase = createBrowserSupabaseClient()
    const { error: authError } = await supabase.auth.signInWithPassword(parsed.data)
    setSubmitting(false)

    if (authError) {
      setError('E-mail ou senha inválidos')
      return
    }

    router.push('/visao-geral')
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold">WEE Fluxo de Caixa</h1>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 3: Implement the auth callback route (password recovery / magic-link landing)**

Create `app/auth/callback/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createServerSupabaseClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(`${origin}/visao-geral`)
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(auth\) app/auth middleware.ts
git commit -m "feat: add login page, auth callback route, and route-protection middleware"
```

---

### Task 9: Navigation config, sidebar, and app shell layout

**Files:**
- Create: `lib/nav.ts`, `components/layout/sidebar.tsx`, `components/layout/empty-state.tsx`, `app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getCurrentMember()` (Task 7).
- Produces: `type NavItem = { label: string; href: string; children?: NavItem[] }`, `NAV_ITEMS: NavItem[]` — consumed by Task 10 (every empty-state page) and Task 12 (navigation e2e test, which iterates `NAV_ITEMS` to visit every route).

- [ ] **Step 1: Define the navigation config**

Create `lib/nav.ts`:
```typescript
export type NavItem = {
  label: string
  href: string
  children?: NavItem[]
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Visão Geral', href: '/visao-geral' },
  {
    label: 'Fluxo de Caixa',
    href: '/fluxo-de-caixa/diario',
    children: [
      { label: 'Diário', href: '/fluxo-de-caixa/diario' },
      { label: 'Mensal', href: '/fluxo-de-caixa/mensal' },
      { label: 'Anual', href: '/fluxo-de-caixa/anual' },
    ],
  },
  { label: 'Contas a Receber', href: '/contas-a-receber' },
  { label: 'Contas a Pagar', href: '/contas-a-pagar' },
  { label: 'Planejar Pagamentos', href: '/planejar-pagamentos' },
  { label: 'Planejamento', href: '/planejamento' },
  { label: 'Cenários', href: '/cenarios' },
  { label: 'Vendas', href: '/vendas' },
  { label: 'Clientes', href: '/clientes' },
  { label: 'Produtos', href: '/produtos' },
  { label: 'Impostos', href: '/impostos' },
  { label: 'Reconciliação', href: '/reconciliacao' },
  { label: 'Integrações', href: '/integracoes' },
  { label: 'Configurações', href: '/configuracoes' },
]
```

- [ ] **Step 2: Implement the shared empty-state component**

Create `components/layout/empty-state.tsx`:
```tsx
export function EmptyState({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
      <h2 className="text-lg font-medium text-neutral-700">{title}</h2>
      <p className="text-sm text-neutral-500">Em construção — chega na {phase}.</p>
    </div>
  )
}
```

- [ ] **Step 3: Implement the sidebar**

Create `components/layout/sidebar.tsx`:
```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS } from '@/lib/nav'

export function Sidebar() {
  const pathname = usePathname()

  return (
    <nav aria-label="Navegação principal" className="w-64 shrink-0 border-r bg-white p-4">
      <div className="mb-6 text-lg font-semibold">WEE</div>
      <ul className="space-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`block rounded px-3 py-2 text-sm ${
                pathname === item.href
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {item.label}
            </Link>
            {item.children && (
              <ul className="ml-3 mt-1 space-y-1 border-l pl-3">
                {item.children.map((child) => (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      className={`block rounded px-3 py-1 text-sm ${
                        pathname === child.href
                          ? 'bg-neutral-900 text-white'
                          : 'text-neutral-600 hover:bg-neutral-100'
                      }`}
                    >
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 4: Implement the `(app)` layout with the auth/RBAC guard**

Create `app/(app)/layout.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/auth/session'
import { Sidebar } from '@/components/layout/sidebar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const member = await getCurrentMember()

  if (!member) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: succeeds with no type errors (routes referenced by the sidebar don't exist yet — that's fine, Next.js only errors on pages it can't build, not on `<Link href>` targets).

- [ ] **Step 6: Commit**

```bash
git add lib/nav.ts components/layout app/\(app\)/layout.tsx
git commit -m "feat: add navigation config, sidebar, and authenticated app shell layout"
```

---

### Task 10: Empty-state pages for every navigation route

**Files:**
- Create: `app/(app)/visao-geral/page.tsx`, `app/(app)/fluxo-de-caixa/diario/page.tsx`, `app/(app)/fluxo-de-caixa/mensal/page.tsx`, `app/(app)/fluxo-de-caixa/anual/page.tsx`, `app/(app)/contas-a-receber/page.tsx`, `app/(app)/contas-a-pagar/page.tsx`, `app/(app)/planejar-pagamentos/page.tsx`, `app/(app)/planejamento/page.tsx`, `app/(app)/cenarios/page.tsx`, `app/(app)/vendas/page.tsx`, `app/(app)/clientes/page.tsx`, `app/(app)/produtos/page.tsx`, `app/(app)/impostos/page.tsx`, `app/(app)/reconciliacao/page.tsx`, `app/(app)/configuracoes/page.tsx`

**Interfaces:**
- Consumes: `EmptyState` component (Task 9).
- Produces: one page per `NAV_ITEMS` entry except `/integracoes` (built separately in Task 11 because it needs the `sync_runs` placeholder table).

- [ ] **Step 1: Create each page as a thin wrapper around `EmptyState`**

Create `app/(app)/visao-geral/page.tsx`:
```tsx
import { EmptyState } from '@/components/layout/empty-state'

export default function VisaoGeralPage() {
  return <EmptyState title="Visão Geral" phase="Fase 5 (Motor de Fluxo de Caixa)" />
}
```

Repeat the same pattern for the remaining 14 pages, each with its matching title and target phase:

- `app/(app)/fluxo-de-caixa/diario/page.tsx` → title `"Fluxo de Caixa — Diário"`, phase `"Fase 5 (Motor de Fluxo de Caixa)"`
- `app/(app)/fluxo-de-caixa/mensal/page.tsx` → title `"Fluxo de Caixa — Mensal"`, phase `"Fase 5 (Motor de Fluxo de Caixa)"`
- `app/(app)/fluxo-de-caixa/anual/page.tsx` → title `"Fluxo de Caixa — Anual"`, phase `"Fase 5 (Motor de Fluxo de Caixa)"`
- `app/(app)/contas-a-receber/page.tsx` → title `"Contas a Receber"`, phase `"Fase 2 (Integração Olist)"`
- `app/(app)/contas-a-pagar/page.tsx` → title `"Contas a Pagar"`, phase `"Fase 2 (Integração Olist)"`
- `app/(app)/planejar-pagamentos/page.tsx` → title `"Planejar Pagamentos"`, phase `"Fase 7 (Payment Scenario Engine)"`
- `app/(app)/planejamento/page.tsx` → title `"Planejamento de Receita"`, phase `"Fase 6 (Forecast Engine)"`
- `app/(app)/cenarios/page.tsx` → title `"Cenários"`, phase `"Fase 6 (Forecast Engine)"`
- `app/(app)/vendas/page.tsx` → title `"Vendas"`, phase `"Fase 8 (Sales and Customer BI)"`
- `app/(app)/clientes/page.tsx` → title `"Clientes"`, phase `"Fase 8 (Sales and Customer BI)"`
- `app/(app)/produtos/page.tsx` → title `"Produtos"`, phase `"Fase 8 (Sales and Customer BI)"`
- `app/(app)/impostos/page.tsx` → title `"Impostos"`, phase `"Fase 9 (Taxes)"`
- `app/(app)/reconciliacao/page.tsx` → title `"Reconciliação Financeira"`, phase `"Fase 4 (Reconciliation Layer)"`
- `app/(app)/configuracoes/page.tsx` → title `"Configurações"`, phase `"uma fase futura"`

Each file follows exactly the same structure as `visao-geral/page.tsx` above, only the component name, title, and phase string change.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: succeeds, all 15 routes listed above appear in the build output route list.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)
git commit -m "feat: add empty-state pages for all navigation routes"
```

---

### Task 11: Integrações page (Saúde das Integrações placeholder)

**Files:**
- Create: `supabase/migrations/0002_sync_runs.sql`, `app/(app)/integracoes/page.tsx`

**Interfaces:**
- Consumes: `createServerSupabaseClient()` (Task 6).
- Produces: table `sync_runs` (`id`, `org_id`, `integration` text, `status` text, `started_at`, `finished_at`, `records_received`, `records_created`, `records_updated`, `error_count`) — the exact shape Fase 2/3 sync jobs will insert into.

- [ ] **Step 1: Add the `sync_runs` migration**

Create `supabase/migrations/0002_sync_runs.sql`:
```sql
create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  integration text not null check (integration in ('olist', 'sumup')),
  status text not null check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_processed integer not null default 0,
  records_received integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  error_count integer not null default 0,
  error_message text
);

create index sync_runs_org_id_idx on sync_runs(org_id);
create index sync_runs_integration_idx on sync_runs(integration);

alter table sync_runs enable row level security;

create policy "members can read sync runs in their org"
  on sync_runs for select
  using (is_org_member(org_id));
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: both migrations apply cleanly, `sync_runs` table exists with 0 rows.

- [ ] **Step 3: Implement the Integrações page**

Create `app/(app)/integracoes/page.tsx`:
```tsx
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { formatDateBR } from '@/lib/format/date'

const INTEGRATIONS = [
  { key: 'olist', label: 'Olist ERP' },
  { key: 'sumup', label: 'SumUp' },
] as const

export default async function IntegracoesPage() {
  const supabase = await createServerSupabaseClient()

  const lastRuns = await Promise.all(
    INTEGRATIONS.map(async ({ key }) => {
      const { data } = await supabase
        .from('sync_runs')
        .select('status, finished_at')
        .eq('integration', key)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return { key, run: data }
    })
  )

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Saúde das Integrações</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {INTEGRATIONS.map(({ key, label }) => {
          const found = lastRuns.find((r) => r.key === key)
          return (
            <div key={key} className="rounded-lg border bg-white p-4">
              <h2 className="font-medium">{label}</h2>
              {found?.run ? (
                <p className="mt-1 text-sm text-neutral-600">
                  Última sincronização: {formatDateBR(found.run.finished_at ?? new Date())} —{' '}
                  {found.run.status}
                </p>
              ) : (
                <p className="mt-1 text-sm text-neutral-500">
                  Nenhuma sincronização registrada ainda.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify it compiles and renders**

Run: `npm run build`
Expected: succeeds. Optionally run `npm run dev`, log in manually (once a test user exists — see Task 12, Step 1), and confirm `/integracoes` shows "Nenhuma sincronização registrada ainda." for both cards.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_sync_runs.sql app/\(app\)/integracoes
git commit -m "feat: add sync_runs table and Saúde das Integrações placeholder page"
```

---

### Task 12: E2E tests (login, redirect, full navigation)

**Files:**
- Create: `tests/e2e/auth.spec.ts`, `tests/e2e/navigation.spec.ts`
- Modify: `tests/e2e/smoke.spec.ts` (delete — superseded by `auth.spec.ts`)

**Interfaces:**
- Consumes: `NAV_ITEMS` (Task 9), the running app against local Supabase (Task 5/6).

- [ ] **Step 1: Create a seeded test user in local Supabase**

Run (with local Supabase running from Task 5):
```bash
npx supabase auth admin create-user --email test@wee.com.br --password senha12345 --confirm
```
If the CLI in use doesn't support `auth admin create-user`, instead create the user via the local Supabase Studio UI (URL printed by `supabase start`) at Authentication → Users → Add user, with the same email/password, and confirm the email.

Then link that user to the seeded WEE org as OWNER_ADMIN by running against the local DB (via `npx supabase db execute` or Studio's SQL editor):
```sql
insert into organization_members (org_id, profile_id, role)
select '00000000-0000-0000-0000-000000000001', id, 'OWNER_ADMIN'
from auth.users where email = 'test@wee.com.br';
```

- [ ] **Step 2: Delete the smoke test (superseded)**

Run: `rm tests/e2e/smoke.spec.ts`

- [ ] **Step 3: Write the auth e2e test**

Create `tests/e2e/auth.spec.ts`:
```typescript
import { test, expect } from '@playwright/test'

test('unauthenticated user is redirected to /login', async ({ page }) => {
  await page.goto('/visao-geral')
  await expect(page).toHaveURL(/\/login/)
})

test('user can log in and reach /visao-geral', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill('test@wee.com.br')
  await page.getByLabel('Senha').fill('senha12345')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/visao-geral/)
  await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible()
})
```

- [ ] **Step 4: Run the auth e2e test**

Run: `npm run test:e2e -- auth`
Expected: PASS (2 tests). If the login test fails, verify the test user from Step 1 exists and is confirmed.

- [ ] **Step 5: Write the full-navigation e2e test**

Create `tests/e2e/navigation.spec.ts`:
```typescript
import { test, expect } from '@playwright/test'
import { NAV_ITEMS } from '@/lib/nav'

function flattenHrefs(items: typeof NAV_ITEMS): string[] {
  return items.flatMap((item) => [item.href, ...(item.children?.map((c) => c.href) ?? [])])
}

test.describe('authenticated navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('E-mail').fill('test@wee.com.br')
    await page.getByLabel('Senha').fill('senha12345')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/visao-geral/)
  })

  for (const href of flattenHrefs(NAV_ITEMS)) {
    test(`route ${href} renders without error`, async ({ page }) => {
      const response = await page.goto(href)
      expect(response?.status()).toBeLessThan(400)
      await expect(page.locator('body')).not.toContainText('Application error')
    })
  }
})
```

- [ ] **Step 6: Run the navigation e2e test**

Run: `npm run test:e2e -- navigation`
Expected: PASS (15 tests, one per route in `NAV_ITEMS`).

- [ ] **Step 7: Commit**

```bash
git add tests/e2e
git commit -m "test: add e2e coverage for login/redirect and full navigation"
```

---

### Task 13: RLS integration test

**Files:**
- Create: `tests/unit/rls/organizations.test.ts`, `vitest.config.rls.ts`

**Interfaces:**
- Consumes: local Supabase instance (Task 5) via `SUPABASE_SERVICE_ROLE_KEY` to set up fixtures, and the anon client to prove isolation.

- [ ] **Step 1: Create a separate Vitest config for RLS tests (they need Node, not jsdom, and hit a real local Postgres)**

Create `vitest.config.rls.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/rls/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

Add to `package.json` `"scripts"`:
```json
"test:rls": "vitest run --config vitest.config.rls.ts"
```

- [ ] **Step 2: Write the RLS test**

Create `tests/unit/rls/organizations.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(url, serviceKey)

const OUTSIDER_EMAIL = 'outsider-rls-test@wee.com.br'
const OUTSIDER_PASSWORD = 'senha12345'

describe('RLS: organizations isolation', () => {
  let outsiderUserId: string

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: OUTSIDER_EMAIL,
      password: OUTSIDER_PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    outsiderUserId = data.user.id
    // Deliberately NOT added to organization_members — this user belongs to no org.
  })

  afterAll(async () => {
    await admin.auth.admin.deleteUser(outsiderUserId)
  })

  it('a user with no organization membership sees zero organizations', async () => {
    const outsiderClient = createClient(url, anonKey)
    const { error: signInError } = await outsiderClient.auth.signInWithPassword({
      email: OUTSIDER_EMAIL,
      password: OUTSIDER_PASSWORD,
    })
    expect(signInError).toBeNull()

    const { data, error } = await outsiderClient.from('organizations').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a user with no organization membership sees zero organization_members rows', async () => {
    const outsiderClient = createClient(url, anonKey)
    await outsiderClient.auth.signInWithPassword({
      email: OUTSIDER_EMAIL,
      password: OUTSIDER_PASSWORD,
    })

    const { data, error } = await outsiderClient.from('organization_members').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
```

- [ ] **Step 3: Run the RLS test**

Run: `npm run test:rls`
Expected: PASS (2 tests). Requires local Supabase running (`npx supabase start`) and `.env.local` populated (Task 6, Step 2).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/rls vitest.config.rls.ts package.json
git commit -m "test: add RLS isolation test proving non-members see no organization data"
```

---

### Task 14: Fase 0 documentation

**Files:**
- Create: `docs/architecture.md`, `docs/data-model.md`, `docs/financial-rules.md`, `docs/assumptions.md`, `docs/decisions.md`, `docs/integrations/olist.md`, `docs/integrations/sumup.md`

**Interfaces:**
- Produces: none consumed by code — this is documentation required by the Fase 0 definition of done in the spec.

- [ ] **Step 1: Write `docs/architecture.md`**

```markdown
# Arquitetura

## Visão geral

    Browser (Next.js App Router)
      -> Next.js Server (API routes / server actions)
        -> Supabase (Postgres + Auth + RLS)

Nenhuma API externa (Olist, SumUp) é chamada diretamente pelo navegador.
Nesta fase (Fase 0+1) nenhuma API externa é chamada — a estrutura de pastas
reserva o espaço (`lib/integrations/`, a ser criado na Fase 2/3), mas a
implementação real começa na Fase 2 (Olist) e Fase 3 (SumUp).

## Stack

Next.js 14 (App Router), TypeScript estrito, Tailwind CSS, shadcn/ui,
Supabase (Postgres + Auth + RLS), Zod, Vitest, Playwright, Supabase CLI para
migrations SQL puro (sem ORM).

## Organização e RBAC

Organização única "WEE", com `org_id` em todas as tabelas relevantes e RLS
aplicado desde a primeira migration. Papéis: OWNER_ADMIN, MANAGER, VIEWER
(ver `docs/decisions.md` ADR-004 e `lib/auth/rbac.ts`).

## Autenticação

Supabase Auth (e-mail + senha), sem cadastro público. Sessão gerenciada via
cookies através de `@supabase/ssr`, renovada a cada request pelo middleware
(`middleware.ts` + `lib/supabase/middleware.ts`).
```

- [ ] **Step 2: Write `docs/data-model.md`**

```markdown
# Modelo de Dados — Fase 0+1

Esta fase cria apenas as tabelas de fundação. As demais entidades descritas
no Prompt Mestre (pedidos, contas a pagar/receber, transações SumUp,
forecast, cenários, impostos, reconciliação) entram em fases posteriores.

## Tabelas desta fase

- `organizations(id, name, created_at)` — seed único: WEE
  (`00000000-0000-0000-0000-000000000001`).
- `profiles(id, full_name, created_at)` — espelha `auth.users`, criado
  automaticamente via trigger `handle_new_user`.
- `organization_members(id, org_id, profile_id, role, created_at)` — `role`
  é o enum `organization_role`: `OWNER_ADMIN`, `MANAGER`, `VIEWER`.
- `audit_logs(id, org_id, actor_profile_id, action, entity, entity_id,
  before, after, created_at)` — genérica, reutilizada por todas as fases
  futuras.
- `sync_runs(id, org_id, integration, status, started_at, finished_at,
  pages_processed, records_received, records_created, records_updated,
  error_count, error_message)` — placeholder para a Fase 2/3; nenhuma linha
  é inserida nesta fase.

## RLS

Toda tabela com `org_id` restringe leitura a membros da mesma organização
via a função `is_org_member(org_id)`. Escrita em `organization_members` é
restrita a `OWNER_ADMIN` via `current_org_role(org_id) = 'OWNER_ADMIN'`.
Ver `supabase/migrations/0001_foundation.sql` para as políticas completas.

## Entidades futuras (não criadas nesta fase)

`integration_connections`, `olist_orders`, `olist_order_items`,
`olist_contacts`, `olist_accounts_payable`, `olist_accounts_receivable`,
`olist_products`, `sumup_transactions`, `sumup_transaction_events`,
`sumup_payouts`, `financial_categories`, `category_rules`,
`cash_balance_snapshots`, `manual_cash_entries`, `forecast_versions`,
`forecast_entries`, `forecast_scenarios`, `payment_scenarios`,
`payment_scenario_items`, `tax_rule_versions`, `reconciliation_matches`.
```

- [ ] **Step 3: Write `docs/financial-rules.md`**

```markdown
# Regras Financeiras

Nenhuma regra financeira é implementada na Fase 0+1 — não há cálculo de
fluxo de caixa, taxas, forecast, sazonalidade, mix de pagamento, impostos ou
reconciliação nesta fase. Este documento será preenchido incrementalmente a
partir da Fase 4 (Reconciliation Layer) em diante, uma seção por motor:

- Fase 4: regra de reconciliação (evitar dupla contagem Olist × SumUp).
- Fase 5: motor de fluxo de caixa (realizado/contratado/projetado/simulado).
- Fase 6: forecast, sazonalidade intramês, mix de pagamento, perfil de
  recebimento, versionamento de forecast, cenários.
- Fase 9: RBT12 e regras tributárias versionadas.
```

- [ ] **Step 4: Write `docs/assumptions.md`**

```markdown
# Suposições e Decisões Pendentes de Validação

- Organização única "WEE" — não há requisito de multi-tenant real no MVP
  (confirmado com o usuário em 2026-08-12).
- 2 a 5 usuários iniciais, papéis OWNER_ADMIN/MANAGER/VIEWER (confirmado com
  o usuário em 2026-08-12).
- Nenhuma suposição financeira foi feita nesta fase — não há dado financeiro
  no sistema ainda.
- Toda suposição fiscal ou de regra de negócio introduzida em fases
  posteriores deve ser registrada aqui com status `NECESSITA VALIDAÇÃO
  CONTÁBIL` quando aplicável, conforme a seção 33 do Prompt Mestre.
```

- [ ] **Step 5: Write `docs/decisions.md`**

```markdown
# Decisões de Arquitetura (ADRs)

## ADR-001: Olist Orders como source of truth para vendas
Contexto: evitar ambiguidade sobre qual sistema define faturamento
operacional. Decisão: Olist é a fonte oficial de pedidos, clientes,
produtos vendidos e faturamento operacional (Fase 2).

## ADR-002: SumUp como source of truth para settlement de pagamentos SumUp
Contexto: evitar dupla contagem entre contas a receber da Olist e
liquidações da SumUp. Decisão: quando uma conta a receber Olist estiver
vinculada a uma venda SumUp, usar a SumUp apenas para refinar data de
liquidação, parcelas, taxas e eventos de payout — nunca somar os dois como
recebimentos distintos (Fase 4).

## ADR-003: Simulações de contas a pagar não escrevem no ERP no MVP
Contexto: primeiro release é read-only para Olist e SumUp. Decisão: o
Planejador de Pagamentos (Fase 7) opera inteiramente em uma camada de
cenário local; nenhuma ação altera vencimentos ou status no ERP.

## ADR-004: Organização única com modelo de dados multi-tenant
Contexto: a WEE é uma única empresa, mas retrofitar `org_id` e RLS depois
seria custoso e arriscado para dados financeiros. Decisão: modelar
`org_id` e RLS por organização desde a primeira migration (Fase 1), com uma
única organização "WEE" seedada; sem UI de gestão de múltiplas empresas
neste MVP.

## ADR-005: Sem ORM — SQL puro via Supabase CLI
Contexto: transparência total é prioritária para lógica financeira que
virá nas próximas fases. Decisão: migrations SQL versionadas via Supabase
CLI, queries manuscritas com `supabase-js`, validação Zod em toda borda —
sem Prisma/Drizzle (Fase 1).
```

- [ ] **Step 6: Write `docs/integrations/olist.md` (skeleton — filled in during Fase 2)**

```markdown
# Integração Olist ERP / Tiny

Status: não implementada nesta fase (Fase 0+1). Implementação começa na
Fase 2.

A implementar na Fase 2, antes de qualquer código:
- Consultar a documentação oficial atual da Olist.
- Preferir API V3; documentar qualquer fallback para V2.
- Registrar aqui: endpoints utilizados, autenticação (OAuth2), scopes,
  paginação, rate limit, campos usados, estratégia incremental, edge cases.

Credenciais: `OLIST_CLIENT_ID`, `OLIST_CLIENT_SECRET`, `OLIST_REDIRECT_URI`
(ver `.env.example`) — já fornecidas pelo usuário, ainda não utilizadas por
nenhum código nesta fase.
```

- [ ] **Step 7: Write `docs/integrations/sumup.md` (skeleton — filled in during Fase 3)**

```markdown
# Integração SumUp

Status: não implementada nesta fase (Fase 0+1). Implementação começa na
Fase 3.

A implementar na Fase 3, antes de qualquer código:
- Consultar a documentação oficial atual da SumUp.
- Registrar aqui: endpoints utilizados (transactions history, transaction
  detail, transaction events, payouts), autenticação, paginação, rate
  limit, campos usados, estratégia incremental, edge cases.

Credenciais: `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE` (ver `.env.example`) —
já fornecidas pelo usuário, ainda não utilizadas por nenhum código nesta
fase.
```

- [ ] **Step 8: Commit**

```bash
git add docs/architecture.md docs/data-model.md docs/financial-rules.md docs/assumptions.md docs/decisions.md docs/integrations
git commit -m "docs: add Fase 0 architecture, data model, financial rules, assumptions, decisions, and integration skeletons"
```

---

### Task 15: Codex review pass

**Files:** none created — review-only task.

- [ ] **Step 1: Run the full test suite one more time end to end**

Run: `npm run lint && npm run build && npm run test && npm run test:e2e && npm run test:rls`
Expected: all pass.

- [ ] **Step 2: Request a Codex review of the diff**

Use the `codex:rescue` skill (or the Codex plugin's review workflow) to get a second opinion on the full diff produced by Tasks 1–14, specifically checking: RLS policy correctness, any accidental client-side exposure of `SUPABASE_SERVICE_ROLE_KEY`, and middleware auth-bypass edge cases.

- [ ] **Step 3: Address any findings**

Fix any issues Codex raises, re-run Step 1's full suite, and commit each fix separately with a message describing what was fixed.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: address Codex review findings for Fase 0+1 foundation"
```

(Skip this commit if Codex found nothing to change.)

---

## Definition of Done (matches the spec)

- [ ] Login funcional; RBAC bloqueia/permite corretamente por papel.
- [ ] Todas as rotas da navegação carregam sem erro (Task 12 proves this for all 15 routes).
- [ ] RLS comprovado por teste (Task 13).
- [ ] `.env.example` completo e documentado (Task 2).
- [ ] `docs/architecture.md`, `docs/data-model.md`, `docs/financial-rules.md`, `docs/assumptions.md`, `docs/decisions.md`, `docs/integrations/olist.md`, `docs/integrations/sumup.md` existem e preenchidos com o que já se sabe nesta fase (Task 14).
- [ ] Codex review realizado e achados endereçados (Task 15).
