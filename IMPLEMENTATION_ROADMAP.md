# Implementation Roadmap: Power Query Parity

**Status**: POST-AUDIT | CORRECTION PHASE  
**Date**: 2026-09-01  
**Target**: 100% Power Query parity before Phase L (UI)

---

## Reconciliation Summary

### Spec Documents Corrections

The following audit documents contain errors and must be updated:

#### FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md

**Corrections Needed**:

| Line | Current | Correct | Reason |
|------|---------|---------|--------|
| 3.1 | IMPLEMENTED_UNVERIFIED | NOT_IMPLEMENTED | taxas_12m table exists but no aggregation logic |
| 3.3 | Formula documented | Formula not in code | Taxa ponderada formula not implemented |
| 3.5-3.8 | Fallback exists | NOT_IMPLEMENTED | 4-tier fallback logic missing |
| 6.1 | Table created | No calculation logic | Sazonalidade table orphaned |
| 6.3 | Invariant test missing | MUST CREATE | SUM(peso_faixa)=1 never tested |
| 8.1 | Table created | No calculation logic | Receipt profile table orphaned |
| 11.5 | 7 brackets test | Use correct values | Boundaries: 180k, 360k, 720k, 1.8M, 3.6M, 4.8M (NOT 1.5M, 2.4M) |
| 12.2 | ValorAberto calc | Verify MAX(0, valor - pago) | Tiny payables may use wrong formula |
| 16.1 | CMV mentioned | BLOCKED_BUSINESS_RULE | No comprovable rule in Power Query |

#### MIGRATION_0023_ARCHITECTURE_AUDIT.md

**Corrections Needed**:

| Section | Current | Correct | Issue |
|---------|---------|---------|-------|
| sumup_fee_rates_12m | "No refresh logic" | ACTION: ADD REFRESH JOB | Correct diagnosis, need implementation |
| sumup_seasonality_3bands_12m | "dias/30 approach" | FIX: Use month arithmetic | Audit identified wrong approach |
| sumup_receipt_profile_12m | "No invariant test" | ACTION: ADD TEST | Correct, need to implement |
| sumup_future_receivables | "Population unknown" | ACTION: DEFINE WORKFLOW | Audit uncertain, clarify |
| financial_ledger | "Insertion undefined" | ACTION: DESIGN DEDUP STRATEGY | Critical, must resolve |

#### CHECKPOINT_3_FORENSIC_AUDIT_RESULTS.md

**Status**: Generally correct, but:
- Correctly identified missing golden tests
- Correctly identified ledger workflow undefined
- Correctly identified RBT12 not validated

No corrections needed; this audit was accurate.

---

## 7 Show-Stoppers: Implementation Plan

### Show-Stopper 1: Taxas_12M Engine

**File**: `lib/analytics/engine.ts` (add function)

**Function**: `calculateFeeRates_12m(orgId: string, adminClient?: AdminClient): Promise<void>`

**Algorithm**:
```
1. Load sumup_transactions for [DataHoje - 12M, DataHoje)
   - Filter: type = PAYMENT, status = SUCCESSFUL, amount > 0
   
2. Load sumup_payouts for same window
   - Filter: transaction_code != null, status = SUCCESSFUL, type = PAYOUT
   - Group by transaction_code
   - Calculate: FeeRealTotal = SUM(ABS(fee))

3. For each transaction:
   - Check: payouts_received >= payouts_total?
   - If NO: FeeConsiderado = null (exclude from fee metrics)
   - If YES: FeeConsiderado = FeeRealTotal

4. Aggregate by (org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan):
   - qtd_transacoes_12m = COUNT(*)
   - valor_bruto_12m = SUM(amount)
   - qtd_com_fee = COUNT(CASE WHEN FeeConsiderado IS NOT NULL)
   - valor_base_taxa_12m = SUM(amount WHERE FeeConsiderado IS NOT NULL)
   - fee_total_12m = SUM(FeeConsiderado)
   - taxa_media_simples = AVG(FeeConsiderado / amount)
   - taxa_media_ponderada = fee_total_12m / valor_base_taxa_12m
   - confiabilidade = CASE
       WHEN qtd_com_fee >= 30 THEN 'ALTA'
       WHEN qtd_com_fee >= 10 THEN 'MEDIA'
       ELSE 'BAIXA'
   - pct_valor_12m = valor_base_taxa_12m / SUM(valor_base_taxa_12m) OVER org
   - pct_transacoes_12m = qtd_transacoes_12m / SUM(qtd_transacoes_12m) OVER org

5. UPSERT into sumup_fee_rates_12m
   - UNIQUE(org_id, payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan)
```

**Tests Required** (Golden Dataset 1):
- Case A: 1 sale, complete payout, fee calculated
- Case B: 3 sales, multiple payouts, fees aggregated
- Case C: 1 sale, incomplete payout, excluded from fee metrics

**Blocker**: Point 3 (payout fee semantics) must be resolved first

---

### Show-Stopper 2: Fee Fallback Lookup

**File**: `lib/analytics/engine.ts` (add function)

**Function**: `lookupFeeRate(orgId: string, payment_type: string, card_type: string, nro_parcelas: number, entry_mode: string, payout_plan: string): Promise<number>`

**Algorithm**:
```
Tier 1 (Exact Match):
  SELECT taxa_media_ponderada FROM sumup_fee_rates_12m
  WHERE org_id = ? AND payment_type = ? AND card_type = ? 
    AND nro_parcelas_modelo = ? AND entry_mode = ? AND payout_plan = ?
    AND confiabilidade != 'BAIXA'
  If found AND qtd_com_fee >= 5: return taxa_media_ponderada

Tier 2 (3D: payment_type + nro_parcelas_modelo):
  SELECT taxa_media_ponderada FROM sumup_fee_rates_12m
  WHERE org_id = ? AND payment_type = ? AND nro_parcelas_modelo = ?
  GROUP BY payment_type, nro_parcelas_modelo
  If found AND COUNT >= 5: return SUM(fee_total_12m) / SUM(valor_base_taxa_12m)

Tier 3 (1D: payment_type only):
  SELECT taxa_media_ponderada FROM sumup_fee_rates_12m
  WHERE org_id = ? AND payment_type = ?
  If found AND COUNT >= 5: return SUM(fee_total_12m) / SUM(valor_base_taxa_12m)

Tier 4 (Global):
  SELECT SUM(fee_total_12m) / SUM(valor_base_taxa_12m)
  FROM sumup_fee_rates_12m WHERE org_id = ?
```

**Tests Required** (Golden Dataset 2):
- Test exact match exists (use it)
- Test exact missing, tier 2 exists (use tier 2)
- Test tier 2 missing, tier 3 exists (use tier 3)
- Test all missing (use global)

---

### Show-Stopper 3: Payout Fee Semantics Verification

**File**: `lib/sumup/sync/payouts.ts` (audit + possibly fix)

**Action**: Verify field semantics
```
1. Read SumUp API documentation for /v1.0/merchants/{code}/payouts
2. Classify each field: GROSS or NET or UNKNOWN
   - amount: ??
   - fee: ??
   - net: ??
3. Create fixture test with documented API response
4. Prove: amount - fee = net (if all three exist)
5. Document in code comment or fixture
```

**Blocker**: Cannot proceed with forecasts without this verified

---

### Show-Stopper 4: Sazonalidade Engine

**File**: `lib/forecast/engine.ts` (add function)

**Function**: `calculateSeasonality_3bands_12m(orgId: string): Promise<void>`

**Algorithm**:
```
1. Load sumup_transactions for [DataHoje - 24M, DataHoje)
   - Filter: type = PAYMENT, status = SUCCESSFUL, amount > 0
   
2. For each transaction, calculate:
   - ano_historico = YEAR(created_at)
   - mes_historico = MONTH(created_at)
   - faixa = CASE
       WHEN DAY(created_at) <= 9 THEN 1
       WHEN DAY(created_at) <= 19 THEN 2
       ELSE 3
   - receita_faixa = ABS(amount - refunded_amount)

3. Aggregate by (ano_historico, mes_historico, faixa):
   - receita_faixa = SUM(receita_faixa)
   - receita_mes = SUM(receita_faixa) OVER (PARTITION BY ano, mes)
   - peso_faixa = COALESCE(receita_faixa / NULLIF(receita_mes, 0), 0.333)
   
4. INVARIANT TEST: SUM(peso_faixa) = 1.0 per (ano, mes)

5. Store in sumup_seasonality_3bands_12m
   - UNIQUE(org_id, ano_historico, mes_historico, faixa)
```

**Tests Required** (Golden Dataset 3):
- Month with 3 bands and expected weights
- Month with one band = 0 revenue (weight = 1/3 each)
- Month-end boundaries (31 Jan, 28/29 Feb, etc.)

---

### Show-Stopper 5: Receipt Profile Engine

**File**: `lib/forecast/engine.ts` (add function)

**Function**: `calculateReceiptProfile_12m(orgId: string): Promise<void>`

**Algorithm**:
```
1. Load sumup_transactions + sumup_payouts
   - JOIN ON transaction_code
   
2. Filter payouts:
   - transaction_code != null
   - date != null
   - amount != null
   - status = SUCCESSFUL OR status IS NULL
   - type = PAYOUT OR type IS NULL

3. For each payout, calculate:
   - data_venda_mes = DATE_TRUNC('month', transaction.created_at)
   - data_recebimento_mes = DATE_TRUNC('month', payout.date)
   - meses_ate_receber = (YEAR(recebimento) - YEAR(venda)) * 12 
                       + (MONTH(recebimento) - MONTH(venda))
   - meses_ate_receber = MAX(0, meses_ate_receber)

4. Aggregate by (payment_type, card_type, nro_parcelas, entry_mode, payout_plan, meses_ate_receber):
   - valor_recebido = SUM(ABS(payout.amount))
   - qtd_recebimentos = COUNT(*)
   - total_modalidade = SUM(valor_recebido) OVER (PARTITION BY payment_type, ...)
   - pct_recebimento_modalidade = valor_recebido / NULLIF(total_modalidade, 0)

5. INVARIANT TEST: SUM(pct_recebimento_modalidade) = 1.0 per modalidade

6. Store in sumup_receipt_profile_12m
```

**Tests Required** (Golden Dataset 5):
- Expected distribution M+0, M+1, M+2
- Month boundaries (31 Jan → 1 Feb = 1 month, NOT 31/30 days)
- Validate SUM(pct) = 1.0

---

### Show-Stopper 6: Ledger Architecture & Deduplication

**File**: Decision required

**Choice Required**:

**Option A: Virtual Ledger (VIEW)**
```sql
CREATE VIEW financial_ledger AS
SELECT 
  gen_random_uuid() as id,
  org_id,
  'SUMUP_PAYOUT_ACTUAL' as nature,
  sp.id as source_id,
  'payout' as source,
  sp.date as event_date,
  sp.amount as amount,
  'entrada' as direction,
  ...
FROM sumup_payouts sp
WHERE sp.status = 'SUCCESSFUL'

UNION ALL

SELECT ...
FROM olist_accounts_receivable ar
...
```

**Pros**: Always fresh, no sync needed  
**Cons**: Expensive per query

**Option B: Persisted Ledger (TABLE with versioning)**
```
Required columns:
  org_id
  source ('SUMUP', 'FORECAST', 'TINY', 'MANUAL')
  source_id (id in source table)
  source_event_id (for events)
  projection_version_id (for forecast)
  nature ('SUMUP_PAYOUT_ACTUAL', 'PROJECTED_SALES', etc)
  event_date
  amount
  direction ('entrada'/'saida')
  status ('actual'/'scheduled'/'projected')
  generated_at
  valid_from
  superseded_at (NULL if current)
```

**Pros**: Indexable, performant, versionable  
**Cons**: Requires refresh logic, deduplication strategy

**Recommendation**: Option B + async refresh jobs

**Deduplication Strategy**:
- UNIQUE constraint: (org_id, source, source_id, source_event_id, event_date, status)
- When payout status changes SCHEDULED → SUCCESSFUL:
  1. Set superseded_at = now() on old SCHEDULED entry
  2. INSERT new SUCCESSFUL entry
  3. Don't delete; keep history

**Tests Required** (Golden Dataset 9):
- Transaction with 3 parcels: 1 realized, 2 scheduled
- Verify: Only 1 actual, 2 scheduled (no double-count)
- Verify: When payout matures, old scheduled gets superseded_at

---

### Show-Stopper 7: Simples Boundaries Correction

**File**: `lib/tax/simples-nacional.ts` (verify/fix)

**Action**: Verify bracket values
```
Correct boundaries (per Power Query spec):
  180000      → Bracket 1
  360000      → Bracket 2
  720000      → Bracket 3
  1800000     → Bracket 4
  3600000     → Bracket 5
  4800000     → Bracket 6
  > 4800000   → Out of scope

Current audit docs reference: 1.5M, 2.4M (WRONG)

1. Verify simples-nacional.ts has correct boundaries
2. If wrong: Update to correct values
3. Create 21-test suite (3 per boundary: -0.01, exact, +0.01)
```

**Tests Required** (Golden Dataset 7):
- RBT12 at each boundary with 3 test points
- Verify correct bracket selected
- Verify correct aliquota applied

---

## Forecast Actualization Rule (Point 24)

**Status**: REQUIRES BUSINESS DECISION

**Question**: When forecast period closes with actual sales, what happens?

**Options**:
1. **Reduce forecast**: forecast(10k) - actual(5k) = remaining forecast(5k)
2. **Track variance**: Keep both; mark which are actual vs forecast
3. **Replace forecast**: Delete old forecast entry when actual arrives
4. **Temporal cutoff**: Forecast only for future; actual for past

**Current spec says**: NOT DEFINED

**Recommendation**: Option 2 (track variance) for observability

**Action**: Define rule, document in financial-rules.md

---

## Implementation Schedule

### Week 1 (Days 1-5)

- [ ] Day 1-2: Correct FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md + MIGRATION_0023_ARCHITECTURE_AUDIT.md
- [ ] Day 2: Show-Stopper 3 (Payout semantics verification)
- [ ] Day 3: Show-Stopper 1 (Taxas_12M engine)
- [ ] Day 4: Show-Stopper 2 (Fee fallback lookup)
- [ ] Day 5: Show-Stopper 4 (Sazonalidade engine)

### Week 2 (Days 6-10)

- [ ] Day 6: Show-Stopper 5 (Receipt profile engine)
- [ ] Day 7: Show-Stopper 6 (Ledger architecture decision + dedup logic)
- [ ] Day 8: Show-Stopper 7 (Simples boundaries verification)
- [ ] Day 9-10: Golden dataset creation + validation

### Deliverables

**End of Week 1**:
- ✅ Spec documents corrected
- ✅ 4 mathematical engines implemented + tested
- ✅ Payout semantics documented

**End of Week 2**:
- ✅ All 7 show-stoppers resolved
- ✅ 10 golden datasets created with manual calculations
- ✅ All tests passing
- ✅ README updated with formulas

---

## Acceptance Criteria

**Specification Parity**: 100%
- ✅ POWER_QUERY_PARITY_CORRECTION_AUDIT.md all points reconciled
- ✅ No silent assumptions; all divergences documented

**Implementation Parity**: >= 90%
- ✅ All 7 show-stoppers implemented
- ✅ All critical formulas match Power Query
- ✅ All table schemas have refresh logic

**Validation Parity**: >= 95%
- ✅ 10 golden datasets with expected values
- ✅ All 10 tests passing
- ✅ No data-consistency violations

**Before Phase L (UI)**:
- ✅ PARITY_VALIDATION_COVERAGE >= 90%
- ✅ TIMEOUTS = 0
- ✅ RLS/Auth tests passing
- ✅ Checkpoint sign-off

---

**Roadmap Created**: 2026-09-01  
**Status**: READY FOR IMPLEMENTATION  
**Next**: Begin Show-Stopper 1 (Taxas_12M engine)
