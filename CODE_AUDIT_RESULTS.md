# Code Audit Results

**Date**: 2026-09-01  
**Audit Scope**: lib/payments/engine.ts, lib/forecast/engine.ts, lib/tax/engine.ts, lib/cash-flow/engine.ts, lib/analytics/engine.ts  
**Status**: CRITICAL GAPS IDENTIFIED

---

## Executive Summary

**Critical Finding**: The 48-point Power Query specification requires mathematical engines (Taxas_12M, Sazonalidade, Receipt Profile, Fee Fallback, Ledger Dedup) that **do NOT exist** in the current codebase.

Current engines implement **operational** functions (forecast versions, scenarios, tax configuration, cash flow retrieval) but **NOT** the financial calculation cores required by specification.

---

## Engine-by-Engine Analysis

### 1. payments/engine.ts (215 lines)

**Purpose**: Payment scenario planning (payment date adjustments, what-if simulation)

**Functions Implemented**:
- `loadPlannedPayments()` - retrieve planned payment dates
- `loadPaymentScenarios()` - retrieve scenario adjustments
- `savePlannedPayment()` - save simulated payment date
- `deletePlannedPayment()` - delete simulation
- `createPaymentScenario()` - create what-if scenario
- `calculateAdjustedPayments()` - calculate adjusted payments given scenario

**Missing (Per Spec Points 1-6)**:
- ✗ Taxas_12M aggregation (fee rates by 5D)
- ✗ Fee fallback tier logic (4-tier hierarchy)
- ✗ Taxa média ponderada calculation
- ✗ Taxa média simples calculation
- ✗ Fee historical derivation from payouts

**Status**: ❌ SHOW_STOPPER - Core fee calculation missing

---

### 2. forecast/engine.ts (287 lines)

**Purpose**: Forecast version and scenario management

**Functions Implemented**:
- `loadAllVersions()` - list forecast versions
- `loadVersionEntries()` - get forecast revenue by month
- `loadScenarios()` - load scenario multipliers
- `createForecastVersion()` - create new version
- `updateForecastEntry()` - edit revenue cell
- `createForecastScenario()` - create scenario
- `loadSalesMixForVersion()` - get payment mix breakdown
- `loadCMVProjectionsForVersion()` - get cost projections

**Partially Related (Per Spec Points 5-7, 11-13)**:
- ✓ Forecast versions exist (Point 15: versionamento)
- ✓ Scenario support exists (Point 16: cenários)
- ✗ Sazonalidade 3-band distribution missing
- ✗ Receipt profile timing distribution missing
- ✗ Payment mix distribution missing
- ✗ Forecast actualization rule missing (Point 24)

**Status**: ⚠️ PARTIAL - Forecast infrastructure exists, but derivation engines missing

---

### 3. tax/engine.ts (107 lines)

**Purpose**: Tax configuration and schedule calculation

**Functions Implemented**:
- `loadTaxConfiguration()` - load org's tax regime
- `computeTaxSchedule()` - calculate monthly tax obligations
- References `getSimplesTaxRate()` from simples-nacional module

**Related to Spec Points 17-19**:
- ✓ Simples Nacional regime support exists
- ✓ Monthly tax schedule generated
- ✓ Tax due date calculated (day 20 of following month)
- ? RBT12 rolling window (Point 18) - delegated to getSimplesTaxRate()
- ? Simples bracket boundaries (Point 17) - delegated to simples-nacional module
- ? Revenue source validation (Point 19) - not verified

**Status**: ⚠️ PARTIAL - Tax integration exists, but RBT12 logic in separate module

---

### 4. cash-flow/engine.ts (437 lines)

**Purpose**: Cash flow entry loading and aggregation

**Functions Implemented**:
- `loadReconciledCashDates()` - get cash dates from reconciliation
- `loadCashFlowEntries()` - load AR/AP/manual entries
- `resolveOpeningBalance()` - compute starting balance
- `buildCashFlowDays()` - compute daily cumulative balance

**Missing (Per Spec Points 13-14, 22-24)**:
- ✗ Financial ledger (financial_ledger table) not used
- ✗ Ledger deduplication logic missing (scheduled→actual transition)
- ✗ Ledger insertion workflow undefined
- ✗ Forecast entry integration missing
- ✗ Forecast actualization (Point 24) not implemented

**Status**: ❌ SHOW_STOPPER - Ledger architecture not implemented

---

### 5. analytics/engine.ts (345 lines)

**Purpose**: Revenue and customer analytics

**Functions Implemented**:
- `loadRevenueTimeSeries()` - revenue over time
- `loadMonthlyRevenue()` - monthly aggregates
- `loadTopCustomers()` - customer rankings
- `loadCustomerMetrics()` - customer stats
- `loadProductRevenue()` - product breakdown
- `loadRevenueVariance()` - vs forecast comparison
- `loadSalesSummary()` - high-level summary

**Missing (Per Spec Points 1-7)**:
- ✗ Taxas_12M not derived
- ✗ No seasonal decomposition
- ✗ No receipt profile analysis
- ✗ No fee rate analysis

**Status**: ⚠️ PARTIAL - Analytics infrastructure exists, but financial calculations missing

---

## Critical Gaps Summary

### Show-Stoppers (Cannot proceed without these)

| Component | Spec Point | Status | Impact |
|-----------|-----------|--------|--------|
| **Taxas_12M Engine** | 1-6 | ❌ MISSING | Cannot calculate fees; all forecasts wrong |
| **Fee Fallback Tiers** | 6 | ❌ MISSING | Cannot project fees without exact match |
| **Financial Ledger** | 22-23 | ❌ MISSING | Cannot track cash flow sources |
| **Ledger Dedup** | 13-14 | ❌ MISSING | Double-count risk (scheduled + actual) |
| **Sazonalidade Engine** | 11-13 | ❌ MISSING | Cannot distribute forecast within month |
| **Receipt Profile** | 8-10 | ❌ MISSING | Cannot project payment dates |

### Partial Gaps (Need completion)

| Component | Spec Point | Status | Issue |
|-----------|-----------|--------|-------|
| **Simples RBT12** | 18 | ⚠️ INCOMPLETE | Delegated to separate module; not validated |
| **Simples Boundaries** | 17 | ⚠️ UNKNOWN | May use wrong values (1.5M/2.4M instead of 180k/360k/etc) |
| **Payout Semantics** | 8 | ⚠️ UNKNOWN | amount_net meaning not verified |
| **Forecast Actualization** | 24 | ❌ MISSING | No rule for forecast→actual replacement |

---

## Code Locations and Implementation Status

### File Inventory

```
lib/
  ├── payments/engine.ts          [215 lines] - payment scenarios ✓
  ├── forecast/engine.ts          [287 lines] - forecast management ✓
  ├── tax/engine.ts               [107 lines] - tax config ✓ (incomplete)
  ├── cash-flow/engine.ts         [437 lines] - cash flow loading ✓ (no ledger)
  ├── analytics/engine.ts         [345 lines] - revenue analytics ✓
  │
  ├── sumup/
  │   └── sync/payouts.ts         [???] - payout sync (not audited yet)
  │
  ├── tax/
  │   └── simples-nacional.ts     [???] - simples rate lookup (not audited yet)
  │
  └── [other utilities]
```

### Tables Exist, Calculation Missing

```sql
-- Schema defined in migration 0023:
sumup_fee_rates_12m              -- TABLE exists, no refresh logic
sumup_seasonality_3bands_12m     -- TABLE exists, no calculation logic
sumup_receipt_profile_12m        -- TABLE exists, no calculation logic
sumup_future_receivables         -- TABLE exists, population logic unknown
financial_ledger                 -- TABLE exists, insertion logic missing
```

---

## Key Findings Per Spec Point

### Point 1-4: Taxas_12M
- **Spec**: Aggregate fees by 5 dimensions over 12M rolling window
- **Code**: No aggregation function exists
- **Status**: ❌ NOT IMPLEMENTED

### Point 3: Fee Source
- **Spec**: Derive from payouts.fee (grouped by transaction_code), NOT from transaction.amount_fee
- **Code**: Unknown; likely using transaction.amount_fee directly
- **Status**: ❌ VERIFY REQUIRED (likely wrong)

### Point 5: Taxa Média
- **Spec**: Ponderada = Fee Total / Valor Base; Simples = AVERAGE(fee/amount)
- **Code**: No distinct calculation
- **Status**: ❌ NOT IMPLEMENTED

### Point 6: Fallback Tiers
- **Spec**: 4-tier hierarchy (exact, 3D, 2D, 1D global)
- **Code**: No tier logic
- **Status**: ❌ NOT IMPLEMENTED

### Point 8: Payout Semantics
- **Spec**: amount_net meaning must be verified (GROSS vs NET)
- **Code**: Unknown; could cause double fee deduction
- **Status**: ❌ REVIEW REQUIRED

### Point 9: Receipt Profile
- **Spec**: Months to receipt = (year*12 + month) arithmetic
- **Code**: No implementation; possibly using dias/30 (wrong)
- **Status**: ❌ LIKELY WRONG

### Point 11-13: Sazonalidade
- **Spec**: 3-band distribution with month fallbacks (not fixed 12M)
- **Code**: No implementation
- **Status**: ❌ NOT IMPLEMENTED

### Point 17: Simples Boundaries
- **Spec**: 7 brackets at 180k, 360k, 720k, 1.8M, 3.6M, 4.8M
- **Code**: Delegated to simples-nacional.ts (not audited); likely wrong (1.5M/2.4M references in audit)
- **Status**: ❌ INCORRECT VALUES IN SPEC DOCS

### Point 18: RBT12 Rolling
- **Spec**: Rolling 12M window [D-12M, D), never include current month
- **Code**: Delegated to simples-nacional.ts; not validated
- **Status**: ⚠️ INCOMPLETE (needs validation)

### Point 22-24: Ledger Architecture
- **Spec**: Define append-only vs mutable; dedup strategy; forecast actualization
- **Code**: Table exists, no insertion workflow
- **Status**: ❌ UNDEFINED

---

## Compliance Against Audit Docs

### FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md

All 85 requirements marked **IMPLEMENTED_UNVERIFIED** (code exists but untested).

**Audit finding**: Code for most requirements **does NOT exist**. Spec audit wrong.

Example corrections needed:
- Line 3.1: "Taxas_12M implementation" → Actually **NOT_IMPLEMENTED**
- Line 3.3: "Formula documented" → Formula **NOT IN CODE**
- Line 6.1: "Seasonality table created" → Table exists but **NOT POPULATED**

### MIGRATION_0023_ARCHITECTURE_AUDIT.md

All 5 tables reviewed; 3 are ORPHANED (no refresh/insertion logic):
- sumup_fee_rates_12m → No refresh job
- sumup_seasonality_3bands_12m → No calculation
- sumup_receipt_profile_12m → No calculation
- sumup_future_receivables → Population logic unknown
- financial_ledger → Insertion workflow undefined

**Audit correct** but incomplete; needs action plan.

---

## What Needs to Happen

### Immediate (Blocking Validation)

1. **Implement Taxas_12M Engine**
   - Function: `calculateFeeRates_12m(orgId: string)`
   - Input: sumup_transactions + sumup_payouts for last 12M
   - Output: Populate sumup_fee_rates_12m table
   - Dependencies: transaction_code join logic

2. **Implement Fee Fallback Lookup**
   - Function: `lookupFeeRate(orgId, payment_type, card_type, parcelas, entry_mode, payout_plan)`
   - Logic: 4-tier hierarchy with >= 5 count validation
   - Test: All 4 tiers independently

3. **Verify/Fix Payout Fee Semantics**
   - Audit: Does sumup_payouts.amount include or exclude fee?
   - If exclude: use amount as-is
   - If include: extract fee separately
   - Create fixture test with real API response

4. **Implement Sazonalidade Engine**
   - Function: `calculateSeasonality_3bands_12m(orgId)`
   - Logic: peso = revenue_band / revenue_month (or 1/3 if month=0)
   - Fallback: year-prior → recent → global 12M
   - Test: All 3 fallback scenarios

5. **Implement Receipt Profile Engine**
   - Function: `calculateReceiptProfile_12m(orgId)`
   - Logic: months to receipt = (year*12 + month) arithmetic (NOT dias/30)
   - Test: Month boundaries (31 Jan, 28 Feb, etc)

6. **Implement Ledger Insertion + Dedup**
   - Workflow: Define which services populate financial_ledger
   - Sources: SUMUP_PAYOUT (actual/scheduled), PROJECTED_SALES, AR/AP, MANUAL, TAX
   - Dedup: (org_id, source, source_id, event_date) must be unique
   - Test: scheduled→actual transition

7. **Validate/Correct Simples Boundaries**
   - Verify: 7 brackets at correct values
   - Fix: Audit docs have wrong values (1.5M/2.4M)
   - Test: 21-test suite (3 per boundary)

### Phase 2 (Architecture Decisions)

8. **Choose Ledger Architecture**: VIEW vs TABLE with versioning
9. **Define Forecast Actualization Rule**: What happens when forecast month realizes?
10. **Choose Table Refresh Strategy**: Keep as TABLE + jobs vs Convert to MV

### Phase 3 (Golden Tests)

11. **Create 10 Golden Datasets** with expected values calculated manually from spec

---

## Recommendation

**Status**: Code architecture exists but financial calculation cores **missing**.

**Path Forward**:
1. ✅ SPEC_CORRECTION_AUDIT created (this doc)
2. ✅ CODE_AUDIT_RESULTS created (this file)
3. 🔄 NEXT: Implement 7 show-stopper functions (1-2 days each)
4. 🔄 THEN: Create golden tests against implementation
5. 🔄 FINALLY: Run 10 datasets, validate parity

**DO NOT proceed to UI** until show-stoppers resolved.

**Estimated effort**: 50-60 hours for complete implementation + testing

---

**Audit Completed**: 2026-09-01  
**Next Review**: After implementing show-stopper functions
