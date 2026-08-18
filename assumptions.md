# Assumptions & Implementation Notes

## Fase 6B — Forecast Projection Engine ✅

**Status:** Complete

### What it does
- Converts forecast entries (versions/scenarios) into projected cash inflows
- Merges actual and forecasted entries into unified cash flow view
- Filters forecasts to future dates only (relative to today)
- Adds new `projetado` bucket to cash flow aggregation

### Files
- `lib/forecast/projection.ts` — Core logic (loadForecastedCashFlowEntries, mergeCashFlowWithForecast)
- `components/cash-flow/forecast-toggle.tsx` — UI toggle for forecast on/off
- `app/(app)/fluxo-de-caixa/mensal|anual/page.tsx` — Integrated into both views
- `lib/cash-flow/aggregate.ts` — Extended to handle projetado bucket
- `lib/cash-flow/classify.ts` — Extended CashBucket type

### Key decisions
- Forecast is opt-in via URL param (`?forecast=true` default)
- Merging happens **after** actual entries loaded to avoid double-counting
- Only future forecasts are included (filtered by {ano, mes} > today)

---

## Fase 7 — Payment Planning Engine ✅

**Status:** 95% Complete (5 tasks done, Task 6 = integration + docs)

### What it does
- Plans when to pay accounts payable (vs when they're due)
- Creates payment scenarios with delay/amount adjustments
- Simulates what-if impacts on cash flow
- Integrates planned payments into cash flow dashboard

### Database Schema

**planned_payments**
- `org_id, ap_id` (unique constraint)
- `planned_date` — when this AP will be paid
- `created_by, created_at`

**payment_scenarios**
- `org_id, id, name, description, is_default`
- `created_by, created_at`

**scenario_adjustments**
- `scenario_id, ap_id` (unique constraint)
- `days_delta` — shift planned payment date by N days
- `percentage` — pay X% of original amount (0-100)

### Files & APIs

#### Core Logic
- `lib/payments/scenarios.ts`
  - `applyScenarioToPayment(payment, adjustment?)` — delay + percentage math
  - `mergePlannedPaymentsIntoFlow(actualEntries, adjustedPayments, today)` — converts to CashFlowEntry

- `lib/payments/engine.ts`
  - `loadPlannedPayments(orgId)` — fetch all planned for org
  - `loadPaymentScenarios(orgId)` — fetch with nested adjustments
  - `savePlannedPayment(orgId, apId, plannedDate, actorProfileId)` — upsert
  - `deletePlannedPayment(orgId, apId)` — delete
  - `createPaymentScenario(orgId, name, description, adjustments, actorProfileId)` — create scenario

- `lib/cash-flow/with-payments.ts`
  - `loadCashFlowWithPlannedPayments(orgId, scenarioId?, includePlanned?)` — main entry point
  - Loads actual entries, adds planned payments (optionally adjusted by scenario)
  - Returns merged cash flow ready for aggregation

#### API Routes
- `GET/POST/DELETE /api/payments/planned` — CRUD planned payments
- `GET/POST /api/payments/scenarios` — CRUD scenarios

#### UI Components
- `components/cash-flow/payments-toggle.tsx` — Toggle planned payments on/off
- `app/(app)/planejar-pagamentos/page.tsx` — Payment planning page
  - Lists all planned payments
  - Shows available scenarios
  - What-if impact section

#### Integration
- `app/(app)/fluxo-de-caixa/mensal/page.tsx` — Added payments toggle + loadCashFlowWithPlannedPayments()
- `app/(app)/fluxo-de-caixa/anual/page.tsx` — Added payments toggle + loadCashFlowWithPlannedPayments()

### Key decisions
- Planned payments default to **ON** in cash flow views (toggle can disable)
- Payments treated as `projetado` bucket entry with origin='payment_plan'
- Future-only filter: planned payment date >= current month
- Scenarios are org-scoped, not per-user
- RLS enforced: read for org members, write only via service_role with code validation
- Date shifting uses UTC to avoid timezone issues

### How it all works together

```
1. Load actual cash flow entries (Fase 5)
2. IF payments enabled:
   - Load planned payments for this org
   - Fetch AP details (amount, due date)
   - IF scenario selected: load adjustments
   - Apply days_delta + percentage to each payment
   - Filter to future-only
   - Convert to CashFlowEntry (bucket='projetado', origin='payment_plan')
3. IF forecast enabled (Fase 6B):
   - Load forecast entries
   - Merge with current entries
4. Aggregate both into daily/monthly view
5. Display with "Saídas Planejadas" toggle to show/hide projected payments
```

### Testing
- 8 unit tests for scenarios.ts (applyScenarioToPayment, merge logic)
- Integration tests for API routes and database operations
- All 364 tests passing

---

## Fase 8 — Analytics (Not Yet Started)

**Next:** Implement Sales/Customer/Product Analytics
- Revenue by customer/product
- Top performers
- Trend analysis
- Variance from forecast

---

## Notes for Future Work

### Fase 7 Enhancements (Post-MVP)
- UI to create/edit payment scenarios
- What-if comparison UI (side-by-side scenarios)
- Payment calendar view
- Approval workflow for payments
- Payment history (actual vs planned)
- Scenario templates ("delay 30 days", "50% now, 50% in 30")

### Cross-phase Integration
- Cash Reserves widget using planned + actual
- Alert when planned payment < cash available
- Scenario impact on borrowing needs (Days Payable Outstanding)

### Security & Data
- All writes via service_role only
- Org isolation enforced at row level
- Created_by audit trail for all mutations
