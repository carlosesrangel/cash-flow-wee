# Fase 6 Completion Plan — Finalizando Planejamento de Receita

**Current Status:** 15 commits ahead of master, 330 tests passing, worktree clean  
**Goal:** Implement 3 critical items, test, commit, merge to master  
**Estimated time:** 2-3 hours

---

## Task 1: API GET /forecast/relatorio (Report Engine)

**Files to create/modify:**
- Create: `app/api/forecast/relatorio/route.ts`
- Modify: `lib/forecast/compare.ts` (verify it exports `compareForecastToActual`)

**What it does:**
- Query params: `?versionId=<uuid>&scenarioId=<uuid>` (both optional)
- Returns: `{ months: Array<{ mes, ano, planejado, realizado, delta, percentual }> }`
- Uses existing `compareForecastToActual()` from `lib/forecast/compare.ts`

**Steps:**
- [ ] Verify `compareForecastToActual` exports and signature
- [ ] Create route handler
- [ ] Add Zod validation for query params (optional UUIDs)
- [ ] Add RLS check (read-only, all org members)
- [ ] Write unit test: `tests/unit/forecast/relatorio-route.test.ts`
- [ ] Commit: "feat: add GET /api/forecast/relatorio"

---

## Task 2: Cenários Page UI

**Files to create:**
- Create: `components/forecast/scenario-list.tsx` — list + create button
- Create: `components/forecast/scenario-multipliers-grid.tsx` — edit grid
- Modify: `app/(app)/cenarios/page.tsx` — replace EmptyState
- Create: `tests/unit/components/scenario-list.test.tsx`
- Create: `tests/unit/components/scenario-multipliers-grid.test.tsx`

**What it does:**
- Load all scenarios for the org
- Show grid: Cenário | Base | Conservador | Otimista | [Custom]
- Click scenario → show its multipliers grid (Ano × Jan–Dez)
- Edit inline if `canCreateScenario(role)`
- Button "Novo Cenário" (if canCreateScenario)
- Visual indicator: which is default (Base? or always Base?)

**Steps:**
- [ ] Verify `canCreateScenario()` exists in `lib/auth/rbac.ts` (create if missing)
- [ ] Create `scenario-list.tsx` component
- [ ] Create `scenario-multipliers-grid.tsx` component
- [ ] Update `app/(app)/cenarios/page.tsx` to load scenarios + render components
- [ ] Add component tests
- [ ] Add form handler for new scenario (POST to `/api/forecast/cenarios`)
- [ ] Commit: "feat: replace Cenários placeholder with scenario list and multipliers grid"

---

## Task 3: Forecast vs Realizado Report Page

**Files to create:**
- Create: `app/(app)/planejamento/forecast-vs-realizado/page.tsx`
- Create: `components/forecast/forecast-report.tsx` — table + comparison
- Create: `components/forecast/forecast-chart.tsx` — line chart
- Create: `tests/unit/components/forecast-report.test.tsx`

**What it does:**
- Query: `/planejamento/forecast-vs-realizado?versionId=<uuid>&scenarioId=<uuid>`
- Load report from `GET /api/forecast/relatorio`
- Show table: Mês | Planejado | Realizado | Diferença | % Diff
- Show chart: forecast vs realizado over time
- Filters (dropdown): Version selector + Scenario selector
- Navigation: link back to Planejamento

**Steps:**
- [ ] Create `forecast-report.tsx` component (table display)
- [ ] Create `forecast-chart.tsx` component (simple line chart using existing chart lib)
- [ ] Create page component
- [ ] Add server-side data fetch using `GET /api/forecast/relatorio`
- [ ] Add component tests
- [ ] Commit: "feat: add Forecast vs Realizado report page"

---

## Task 4: Final Verification & Merge

**Steps:**
- [ ] Run full test suite: `npm run test`
- [ ] Run build: `npm run build`
- [ ] Check Supabase migrations are in order (should be ✅ already)
- [ ] Go back to master branch
- [ ] Merge worktree into master (PR or direct merge)
- [ ] Verify master tests still pass
- [ ] Push to GitHub

---

## Files Checklist

### After Task 1 (API)
```
app/api/forecast/relatorio/route.ts (NEW)
tests/unit/forecast/relatorio-route.test.ts (NEW)
```

### After Task 2 (Cenários UI)
```
components/forecast/scenario-list.tsx (NEW)
components/forecast/scenario-multipliers-grid.tsx (NEW)
app/(app)/cenarios/page.tsx (MODIFIED: EmptyState → real)
tests/unit/components/scenario-list.test.tsx (NEW)
tests/unit/components/scenario-multipliers-grid.test.tsx (NEW)
```

### After Task 3 (Report Page)
```
app/(app)/planejamento/forecast-vs-realizado/page.tsx (NEW)
components/forecast/forecast-report.tsx (NEW)
components/forecast/forecast-chart.tsx (NEW)
tests/unit/components/forecast-report.test.tsx (NEW)
```

---

## Notes

- All new routes use `service_role` via route handlers (pattern established in Phase 5)
- All new components use existing Tailwind + shadcn/ui patterns
- All tests follow existing Vitest + mocking patterns
- Portuguese UI copy, BRL formatting, dd/MM/yyyy dates
- Audit logging: report generation is read-only, no audit entry needed
- No integration tests in this sprint (Playwright e2e can come in Phase 6B)
