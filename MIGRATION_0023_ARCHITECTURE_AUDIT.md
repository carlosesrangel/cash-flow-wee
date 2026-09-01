# Migration 0023 Architecture Audit

**Migration**: `0023_financial_analytics_layer.sql`  
**Date**: 2026-09-01  
**Size**: 13 KB  
**Tables Created**: 5  
**Views Created**: 0  
**Functions Created**: 3  
**Status**: ARCHITECTURE_REVIEW_REQUIRED

---

## Executive Summary

Migration 0023 creates 5 persistent tables for the financial model. This audit assesses whether each should remain a TABLE, be converted to a VIEW, MATERIALIZED VIEW, or moved to computed-in-service logic.

**Critical Finding**: The migration persists aggregation tables that may accumulate stale data. Each table needs clear justification for persistence vs. computation.

---

## Table 1: `sumup_fee_rates_12m`

### Basic Info
- **Type**: TABLE (persistent)
- **Size**: Small (aggregated metrics, max ~1000 rows per org)
- **Key Columns**: org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan, taxa_media_ponderada, confiabilidade
- **Unique Constraint**: (org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan)
- **RLS**: Yes, read-only for members
- **Indexes**: org_id, (org_id, payment_type)

### Data Characteristics
- **What it stores**: Aggregated fee statistics from last 12 months of SumUp payouts
- **Is it derived?**: YES - fully derived from sumup_payouts + sumup_transactions
- **Freshness requirement**: CRITICAL - must be fresh for forecast generation
- **Recalculation frequency**: Should be daily or on-demand
- **Stale data risk**: HIGH - if not refreshed, forecasts use outdated fee rates

### Derivation Source
```
SELECT 
  org_id,
  payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan,
  COUNT(*) as qtd_transacoes_12m,
  SUM(amount_gross) as valor_bruto_12m,
  COUNT(CASE WHEN amount_fee IS NOT NULL THEN 1 END) as qtd_com_fee,
  SUM(CASE WHEN payouts_received >= payouts_total THEN amount_gross ELSE 0 END) as valor_base_taxa_12m,
  SUM(amount_fee) as fee_total_12m,
  ... computed rates ...
FROM sumup_transactions
WHERE created_at >= NOW() - INTERVAL '12 months'
  AND payouts_received >= payouts_total  -- ONLY complete payouts
  AND status = 'SUCCESSFUL'
GROUP BY org_id, payment_type, card_type, ...
```

### Current Implementation
- ✓ Table exists with correct columns
- ✓ Constraints defined
- ✓ RLS policies defined
- ✗ **NO REFRESH LOGIC** - unclear when/how this gets populated
- ✗ **NO TRIGGER OR JOB** - orphaned table?
- ✗ **NO SERVICE FUNCTION** - who calls the aggregation?

### Recommendation
**ACTION REQUIRED: DEFINE REFRESH PATTERN**

**Option A (RECOMMENDED)**: Keep as TABLE, add refresh logic
- Create daily cron job or on-demand RPC to recalculate
- Document refresh SLA
- Add `refreshed_at` timestamp to track staleness
- Use in forecasting with confidence check

**Option B**: Convert to MATERIALIZED VIEW
- Automatically indexes aggregations
- Can refresh on cron
- Simpler to reason about (it's the query result)
- Cost: storage + refresh time

**Option C**: Compute in service (NOT RECOMMENDED for this case)
- Every forecast request recalculates 12M aggregation
- Too expensive for hot path
- But possible if only called on-demand

**Current State**: 🔴 INCOMPLETE - Table exists but no refresh mechanism

---

## Table 2: `sumup_seasonality_3bands_12m`

### Basic Info
- **Type**: TABLE (persistent)
- **Size**: Tiny (12 months × 3 bands × ~1-5 payment types = ~40-50 rows per org)
- **Key Columns**: org_id, ano_historico, mes_historico, faixa, peso_faixa
- **Unique Constraint**: (org_id, ano_historico, mes_historico, faixa)
- **RLS**: Yes, read-only for members
- **Indexes**: org_id, (org_id, mes_historico)

### Data Characteristics
- **What it stores**: Historical intra-month seasonality (how revenue distributes across days 1-9, 10-19, 20-end)
- **Is it derived?**: YES - fully derived from sumup_transactions grouped by day-band
- **Freshness requirement**: MEDIUM - seasonality is typically stable month-to-month
- **Recalculation frequency**: Should be monthly after each month completes
- **Stale data risk**: MEDIUM - if revenue pattern changed, old weights are inaccurate

### Derivation Source
```
WITH monthly_revenue AS (
  SELECT 
    org_id,
    EXTRACT(YEAR FROM event_date) as ano,
    EXTRACT(MONTH FROM event_date) as mes,
    CASE 
      WHEN EXTRACT(DAY FROM event_date) <= 9 THEN 1
      WHEN EXTRACT(DAY FROM event_date) <= 19 THEN 2
      ELSE 3
    END as faixa,
    SUM(amount_gross) as receita_faixa
  FROM sumup_transactions
  WHERE created_at >= NOW() - INTERVAL '12 months'
    AND status = 'SUCCESSFUL'
  GROUP BY org_id, ano, mes, faixa
)
SELECT 
  org_id, ano_historico, mes_historico, faixa,
  receita_faixa,
  SUM(receita_faixa) OVER (PARTITION BY org_id, ano, mes) as receita_mes,
  COALESCE(receita_faixa / NULLIF(receita_mes, 0), 0.333) as peso_faixa
FROM monthly_revenue
```

### Current Implementation
- ✓ Table exists with correct columns
- ✓ Constraints check peso_faixa in [0,1]
- ✓ RLS policies defined
- ✗ **NO REFRESH LOGIC** - orphaned table
- ✗ **NO INVARIANT TEST** - SUM(peso_faixa per month) should = 1

### Risk Assessment
**Data Freshness**: If org stopped syncing SumUp 6 months ago, this table still has old seasonality. Forecast applies outdated weights.

### Recommendation
**ACTION REQUIRED: MONTHLY REFRESH + INVARIANT TEST**

**Option A (RECOMMENDED)**: Keep as TABLE, add monthly refresh
- Refresh after month-end (or on-demand)
- Add validation: SUM(peso_faixa) = 1.0 per org/mes (within 0.01 tolerance)
- Document: "Uses last 12 months of data; if org has <12M history, applies uniform 1/3 per band"

**Option B**: Convert to MATERIALIZED VIEW with monthly refresh
- Simpler maintenance (query + refresh schedule)
- Natural fit for derived data

**Option C**: Compute at forecast time (NOT RECOMMENDED)
- Every forecast recalculates 12M seasonality
- Expensive
- But ensures freshness

**Current State**: 🔴 INCOMPLETE - Table exists but no refresh mechanism, no invariant test

---

## Table 3: `sumup_receipt_profile_12m`

### Basic Info
- **Type**: TABLE (persistent)
- **Size**: Medium (payment_type × card_type × parcelas × timing_buckets = ~200-500 rows per org)
- **Key Columns**: org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan, meses_ate_receber, pct_recebimento_modalidade
- **Unique Constraint**: (org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan, meses_ate_receber)
- **RLS**: Yes, read-only for members
- **Indexes**: org_id, (org_id, meses_ate_receber)

### Data Characteristics
- **What it stores**: Historical timing distribution of how long it takes to receive payment by payment modality
- **Is it derived?**: YES - fully derived from sumup_transaction_events status timeline
- **Freshness requirement**: MEDIUM-HIGH - payment timing can shift if SumUp changes settlement rules
- **Recalculation frequency**: Should be monthly after historical month closes
- **Stale data risk**: MEDIUM - if payment timing pattern changed, forecasts use wrong payment schedule

### Derivation Source
```
WITH receipt_timeline AS (
  SELECT 
    org_id,
    payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan,
    (EXTRACT(EPOCH FROM actual_payout_date - sale_date) / (24*3600*30))::INT as meses_ate_receber,
    COUNT(*) as qtd_recebimentos,
    SUM(amount_net) as valor_recebido
  FROM sumup_transaction_events 
  WHERE event_status IN ('SUCCESSFUL', 'RECONCILED')
    AND created_at >= NOW() - INTERVAL '12 months'
  GROUP BY org_id, payment_type, card_type, ..., meses_ate_receber
)
SELECT 
  org_id, payment_type, card_type, ..., meses_ate_receber,
  valor_recebido as valor_recebido_historico,
  qtd_recebimentos,
  SUM(valor_recebido) OVER (PARTITION BY org_id, payment_type, card_type, ...) as total_recebido_modalidade,
  valor_recebido / NULLIF(total_recebido_modalidade, 0) as pct_recebimento_modalidade
FROM receipt_timeline
```

### Current Implementation
- ✓ Table exists with correct columns
- ✓ Constraints check pct in [0,1]
- ✓ RLS policies defined
- ✗ **NO REFRESH LOGIC** - orphaned table
- ✗ **NO INVARIANT TEST** - SUM(pct per modality, all timing buckets) should = 1

### Risk Assessment
**Data Freshness**: If SumUp changed settlement timing (e.g., now pays out D+2 instead of D+1), old profile is wrong. Forecast projects incorrect cash flow dates.

### Recommendation
**ACTION REQUIRED: MONTHLY REFRESH + INVARIANT TEST**

**Option A (RECOMMENDED)**: Keep as TABLE, add monthly refresh
- Refresh after month-end
- Add validation: SUM(pct_recebimento_modalidade) = 1.0 per org/payment_mode (within 0.01 tolerance)
- Document: "If modality has no recent history, apply fallback distribution"

**Option B**: Convert to MATERIALIZED VIEW with monthly refresh
- Natural fit for derived data
- Simpler to reason about

**Current State**: 🔴 INCOMPLETE - Table exists but no refresh mechanism, no invariant test

---

## Table 4: `sumup_future_receivables`

### Basic Info
- **Type**: TABLE (persistent)
- **Size**: Medium (all sales' future payouts = ~5000-50K rows per org depending on volume)
- **Key Columns**: org_id, sumup_transaction_id, sumup_transaction_event_id, installment_number, event_type, event_status, amount_event, taxa_projetada, fonte_taxa_projetada, valor_recebivel_bruto, fee_projetado, valor_recebivel_liquido
- **Unique Constraint**: (org_id, sumup_transaction_id, installment_number)
- **RLS**: Yes, read-only for members
- **Indexes**: org_id, (org_id, due_date), (org_id, event_status)

### Data Characteristics
- **What it stores**: Future receivables from EXISTING sales (real transactions from SumUp API, not forecast)
- **Is it derived?**: PARTIALLY
  - Source data: sumup_transactions + sumup_transaction_events (from SumUp API, actual)
  - Computed: taxa_projetada (lookup from fee_rates table), fee_projetado (calculated)
  - Status: Infrequent updates (only when a scheduled payout matures to actual)
- **Freshness requirement**: HIGH - must sync every time SumUp API is called
- **Recalculation frequency**: Every SumUp sync (hourly or on-demand)
- **Stale data risk**: HIGH - if a payout status changes in SumUp but we don't sync, ledger is outdated

### How It's Populated (Expected)
1. Call SumUp API (payouts endpoint)
2. For each SCHEDULED/PENDING payout:
   - Look up transaction_id to find original transaction
   - Determine payment_type, card_type, parcelas from original transaction
   - Lookup fee rate from `sumup_fee_rates_12m` (4-tier fallback)
   - Calculate projected fee
   - Calculate net receivable (amount - fee)
   - UPSERT into sumup_future_receivables

### Current Implementation
- ✓ Table exists with correct columns
- ✓ Unique constraint on (org_id, tx_id, installment_number) prevents duplicates
- ✓ RLS policies defined
- ✗ **NO POPULATION LOGIC** - unclear who populates this table
- ✗ **NO SYNC TRIGGER** - does it auto-update when sumup_payouts changes?
- ✗ **NO ORPHAN DETECTION** - test for FK integrity

### Risk Assessment
**Data Integrity**: If this table is never populated, cash flow forecasts are wrong. If populated but then cleared, financial reports become blank.

### Architecture Question
**CRITICAL**: Should this be a VIEW instead of a TABLE?

```sql
-- Option: Create as VIEW (same query as population logic)
CREATE VIEW sumup_future_receivables_view AS
SELECT 
  gen_random_uuid() as id,
  org_id,
  sumup_transaction_id,
  sumup_transaction_event_id,
  (SELECT nro_parcelas FROM sumup_transactions WHERE id = st.id) as installment_number,
  sp.type as event_type,
  sp.status as event_status,
  sp.amount as amount_event,
  sp.due_date,
  sp.event_date,
  COALESCE(
    -- Tier 1: exact match
    (SELECT taxa_media_ponderada FROM sumup_fee_rates_12m 
     WHERE org_id = sp.org_id 
       AND payment_type = st.payment_type
       AND card_type = st.card_type
       AND nro_parcelas_modelo = (SELECT nro_parcelas FROM sumup_transactions WHERE id = st.id)
       AND entry_mode = st.entry_mode
       AND payout_plan = sp.payout_plan),
    -- Tier 2, 3, 4 fallback ...
    0.05  -- Global default 5% if nothing found
  ) as taxa_projetada,
  ...
FROM sumup_payouts sp
JOIN sumup_transactions st ON sp.sumup_transaction_id = st.id
WHERE sp.status IN ('SCHEDULED', 'PENDING', 'RECONCILED')
```

**Benefits**:
- Always fresh (pulls latest from sumup_payouts + fee_rates)
- No synchronization needed
- Natural for derived data

**Drawbacks**:
- More expensive per query (join + aggregation lookup)
- But likely only called during forecast generation (not on hot path)

### Recommendation
**ACTION REQUIRED: CHOOSE ARCHITECTURE**

**Option A**: Keep as TABLE, add sync logic + orphan tests
- Requires: SumUp sync must populate this table after fetching payouts
- Requires: Test that when payout status changes, table is updated
- Requires: Test for orphaned rows (tx_id doesn't exist in sumup_transactions)
- Risk: If sync fails, table gets stale

**Option B (RECOMMENDED)**: Convert to VIEW
- Simpler logic (query-not-store)
- Automatically fresh
- Reduces sync burden
- Only pay cost when needed (forecast generation)
- Use indexed base tables (sumup_payouts, sumup_fee_rates_12m) for performance

**Current State**: 🔴 CRITICAL - Table exists but population logic is unknown, architecture choice not yet made

---

## Table 5: `financial_ledger`

### Basic Info
- **Type**: TABLE (persistent, append-only)
- **Size**: Large (every cash flow event = ~1000s-100Ks rows per org over time)
- **Key Columns**: org_id, event_date, competence_date, amount, direction (entrada/saida), nature, source, source_id, status, is_actual/is_projected/is_scheduled
- **RLS**: Yes, read-only for members, insert for members
- **Indexes**: org_id, (org_id, event_date), (org_id, competence_date), (org_id, source, source_id), (org_id, status)

### Data Characteristics
- **What it stores**: Canonical immutable ledger for all cash flow (the "source of truth" for daily balance)
- **Is it derived?**: NO - it's the master record
- **Freshness requirement**: CRITICAL - must be up-to-date for cash flow views
- **Entry sources**:
  1. OPENING_BALANCE (seed)
  2. SUMUP_PAYOUT_ACTUAL (from sumup_payouts when status=SUCCESSFUL)
  3. SUMUP_PAYOUT_SCHEDULED (from sumup_payouts when status=SCHEDULED)
  4. PROJECTED_SALES_RECEIPT (from forecast → seasonality → mix → fee → timing calculation)
  5. ACCOUNTS_RECEIVABLE (from tiny_invoices open balance)
  6. ACCOUNTS_PAYABLE (from tiny_invoices open supplier balance)
  7. PROJECTED_SIMPLES_TAX (calculated monthly on tax due date)
  8. MANUAL_INFLOW (user-entered)
  9. MANUAL_OUTFLOW (user-entered)

### Current Implementation
- ✓ Table exists with correct columns and constraints
- ✓ RLS policies defined
- ✓ Indexes for common queries
- ✗ **NO INSERT TRIGGERS** - unclear who populates this table
- ✗ **NO DEDUPLICATION LOGIC** - risk of double-counting (e.g., payout scheduled + payout actual both in ledger)
- ✗ **NO INTEGRITY TESTS** - test for orphans, duplicates, balance coherence

### Critical Questions

**Q1**: Who populates the ledger?
- Is there a service that listens to sumup_payouts changes and inserts?
- Is it called from a sync job?
- Is it called from a forecast generation job?

**Q2**: Deduplication strategy?
- When a payout changes from SCHEDULED → SUCCESSFUL:
  - Do we UPDATE the old ledger entry (change status)?
  - Do we DELETE the old entry and INSERT new?
  - Do we keep both and let cash flow logic handle "only count actual"?
- If we keep both, cash flow queries MUST filter correctly

**Q3**: Forecast entries in ledger?
- When forecast is generated (e.g., "March revenue → receivables by date"), does it INSERT into ledger immediately?
- If yes, when forecast is edited, do we DELETE old forecast entries?
- Risk: User deletes old forecast, but ledger still has old PROJECTED_SALES_RECEIPT entries

**Q4**: Uniqueness constraint?
- Should (org_id, source, source_id, source_event_id, event_date) be unique?
- Prevents accidental duplicates from sync failures

### Recommendation
**ACTION REQUIRED: DEFINE INSERTION WORKFLOW**

**Must have**:
1. Document which services/jobs insert into financial_ledger
2. For each source type (SUMUP_PAYOUT_ACTUAL, PROJECTED_SALES_RECEIPT, etc):
   - What triggers insertion?
   - Who is responsible?
   - What is the SLA (how quickly after event)?
3. Deduplication strategy:
   - Add UNIQUE constraint: (org_id, source, source_id, source_event_id, event_date, status)
   - Or add trigger to handle scheduled → actual transition
4. Orphan detection test:
   - For each SUMUP_PAYOUT_* entry, verify source_id exists in sumup_payouts
   - For each ACCOUNTS_RECEIVABLE entry, verify source_id exists in tiny_invoices
   - etc.
5. Balance coherence test:
   - Opening balance + SUM(entrada ledger) - SUM(saida ledger) should match expected cash position

**Current State**: 🔴 CRITICAL - Master record table created but insertion logic undefined, deduplication strategy missing

---

## Functions

### 1. `normalize_financial_string(text) → text`
- **Purpose**: Standardize payment_type, card_type strings (e.g., "card" → "CARD")
- **Immutable**: Yes (safe for indexing)
- **Status**: ✓ GOOD - simple and correct

### 2. `current_org_date(target_org_id uuid) → date`
- **Purpose**: Get "today" in org's timezone (critical for date-based logic)
- **Stable**: Yes (depends on org row only)
- **Status**: ✓ GOOD - necessary for consistent date boundaries

### 3. `calculate_simples_effective_rate(rbt12, nominal_rate, deduction_amount) → numeric`
- **Purpose**: Compute (nominal_rate × rbt12 - deduction) / rbt12
- **Immutable**: Yes
- **Status**: ✓ GOOD - simple arithmetic, but needs validation test

---

## Summary Table

| Table | Type | Size | Is Derived | Refresh Needed | Architecture Decision | Status |
|-------|------|------|-----------|---|---|---|
| sumup_fee_rates_12m | TABLE | Small | YES | YES (daily) | Add refresh logic or convert to MV | 🔴 INCOMPLETE |
| sumup_seasonality_3bands_12m | TABLE | Tiny | YES | YES (monthly) | Add refresh logic or convert to MV | 🔴 INCOMPLETE |
| sumup_receipt_profile_12m | TABLE | Medium | YES | YES (monthly) | Add refresh logic or convert to MV | 🔴 INCOMPLETE |
| sumup_future_receivables | TABLE | Medium | PARTIAL | YES (per sync) | Consider VIEW option | 🔴 CRITICAL |
| financial_ledger | TABLE | Large | NO | ONGOING | Define insertion workflow | 🔴 CRITICAL |

---

## Critical Blockers

### 1. **sumup_fee_rates_12m**: No Refresh Mechanism
**Impact**: Forecasts use stale fee rates if table is never updated  
**Fix**: Add daily refresh job or convert to materialized view  
**Blocker**: Cannot accept checkpoint until this is decided and implemented

### 2. **sumup_seasonality_3bands_12m**: No Refresh + No Invariant Test
**Impact**: Forecasts use outdated seasonality; no test ensures SUM(peso)=1  
**Fix**: Add monthly refresh + validation test  
**Blocker**: Cannot accept checkpoint until this is decided and implemented

### 3. **sumup_receipt_profile_12m**: No Refresh + No Invariant Test
**Impact**: Forecasts project wrong payment dates; no test ensures SUM(pct)=1  
**Fix**: Add monthly refresh + validation test  
**Blocker**: Cannot accept checkpoint until this is decided and implemented

### 4. **sumup_future_receivables**: Unknown Population Logic
**Impact**: This table may be empty (never populated) or stale (not kept in sync with SumUp API)  
**Fix**: Define sync logic or convert to VIEW  
**Blocker**: CRITICAL - Cannot build accurate cash flow without this  

### 5. **financial_ledger**: No Insertion Workflow Defined
**Impact**: Master ledger may never be populated; double-counting risk  
**Fix**: Define which services populate, deduplication strategy, orphan tests  
**Blocker**: CRITICAL - Cash flow is useless without populated ledger

---

## Recommendations for Proceeding

### Immediate (Before Checkpoint 3 Acceptance)

1. **Audit Service Code**: Search codebase for who calls refresh/insert for each table
   ```bash
   grep -r "sumup_fee_rates_12m\|sumup_seasonality_3bands\|sumup_receipt_profile\|sumup_future_receivables\|financial_ledger" lib/
   ```
   Document each service function that touches these tables

2. **Define Refresh Patterns**: For each of the first 3 aggregation tables, choose:
   - Option A: Keep as TABLE, add refresh job
   - Option B: Convert to MATERIALIZED VIEW

3. **Decide sumup_future_receivables Architecture**: 
   - View vs Table with sync logic
   - If Table: define sync responsibility
   - If View: test the join performance

4. **Define Ledger Insertion Workflow**:
   - Document each source type and who inserts it
   - Define deduplication (unique constraint or trigger)
   - Write orphan detection test
   - Write balance coherence test

5. **Add Invariant Tests**:
   - SUM(pct_valor_12m) = 1 per org
   - SUM(peso_faixa) = 1 per org/month
   - SUM(pct_recebimento_modalidade) = 1 per org/modality

### Nice-to-Have (Post-Checkpoint 3)

- Convert derived aggregation tables to MATERIALIZED VIEWs for clearer semantics
- Add `refreshed_at` timestamp to aggregation tables to track staleness
- Create refresh monitoring dashboard

---

## Conclusion

**Status**: ARCHITECTURE_REVIEW_REQUIRED (Do not proceed to Phase L until addressed)

The 5 tables created by migration 0023 represent good database schema design, but the operational logic (refresh, insertion, deduplication) is **NOT YET IMPLEMENTED OR TESTED**.

This creates a situation where:
- ✓ Database schema is ready
- ✗ Refresh logic is undefined (tables may be empty or stale)
- ✗ Ledger insertion workflow is undefined (cash flow may be blank)
- ✗ Invariant validation is missing (no test for correctness)

**Before accepting Checkpoint 3**, the user must:
1. Verify these tables are actually being populated
2. Add refresh/sync logic where missing
3. Add invariant tests for all derived data
4. Document the complete data flow

**DO NOT PROCEED TO PHASE L (UI) until this audit is completed and all blockers are resolved.**
