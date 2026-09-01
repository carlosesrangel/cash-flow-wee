# Power Query Parity Correction Audit

**Date**: 2026-09-01  
**Source of Truth**: Legacy Power Query Specification (48-Point Reconciliation)  
**Target**: 100% parity between specifications, code, and documentation  
**Status**: IN_PROGRESS

---

## Executive Summary

This audit reconciles 48 critical power query specifications against:
1. FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md (audit doc A)
2. MIGRATION_0023_ARCHITECTURE_AUDIT.md (audit doc B)
3. Current implementation (lib/ engines)

**Key Finding**: Multiple divergences exist. Power Query specification takes precedence.

---

## Specification: Taxas_12M (Point 1-4)

### POWER_QUERY_RULE

**Window**: DataHoje - 12 months to DataHoje

**Filters**:
- type = PAYMENT
- status = SUCCESSFUL
- amount > 0

**nro_parcelas_modelo hierarchy**:
1. installments_count (if valid)
2. payouts_total (if valid)
3. 1 (default)

**Normalization**:
- payment_type: TRIM + UPPER
- card_type: TRIM + UPPER
- entry_mode: TRIM + UPPER
- payout_plan: TRIM + UPPER
- NULL/empty values → "NAO_INFORMADO"

**Derivation source**:
- Transactions aggregated by (payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan)
- Payouts must satisfy: transaction_code != null AND status = SUCCESSFUL AND type = PAYOUT
- Then grouped by transaction_code

| Field | PQ Rule | Audit Doc A | Current Code | MATCH | ISSUE |
|-------|---------|-------------|--------------|-------|-------|
| Window | 12M rolling | ✓ (3.1) | Unknown | ? | IMPLEMENTATION_CHECK_REQUIRED |
| Filter: type | PAYMENT | Not explicit | Unknown | ? | VERIFY_IN_ENGINE |
| Filter: status | SUCCESSFUL | ✓ (3.1) | Unknown | ? | VERIFY_IN_ENGINE |
| Filter: amount | > 0 | Not explicit | Unknown | ? | MISSING_IN_SPEC |
| nro_parcelas hierarchy | 3-tier | Not described | Unknown | ? | IMPLEMENTATION_ERROR - audit assumes flat lookup |
| Normalization | TRIM/UPPER | Not described | Unknown | ? | MISSING_IN_SPEC |

**CORRECTIONS NEEDED**:
- ✗ FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md does not document the 3-tier hierarchy for nro_parcelas_modelo
- ✗ MIGRATION_0023_ARCHITECTURE_AUDIT.md does not specify normalization rules
- ✓ Prompt specification is clear; update matrix and audit to match

**Status**: DOCUMENTATION_ERROR + IMPLEMENTATION_VERIFICATION_REQUIRED

---

## Specification: Fee Histórico Source (Point 3)

### POWER_QUERY_RULE

**Fee is NOT derived from**: `sumup_transactions.amount_fee` directly

**Correct derivation**:
1. Start with Payouts table
2. Filter: transaction_code != null
3. Filter: status = SUCCESSFUL
4. Filter: type = PAYOUT
5. Group by transaction_code
6. FeeRealTotal = SUM(ABS(payout.fee))
7. ValorRecebidoTotal = SUM(payout.amount)
8. QtdRecebimentos = COUNT(payout rows)
9. JOIN back to Transaction

**Sequence**:
```
SUMUP TRANSACTION
  ← transaction_code →
AGGREGATED PAYOUTS (via transaction_code grouping)
```

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Fee source | Payouts, not transactions | "amount_fee semantics unknown" | Uses `amount_fee` directly? | ✗ | SUMUP_AMOUNT_SEMANTICS_REVIEW_REQUIRED |
| Derivation path | via transaction_code grouping | Not described | Unknown | ? | REQUIRES_AUDIT |
| FeeRealTotal formula | SUM(ABS(fee)) | Not described | Unknown | ? | VERIFY |
| ValorRecebidoTotal | SUM(amount) | Not described | Unknown | ? | VERIFY |

**CORRECTIONS NEEDED**:
- ✗ Current implementation may be using transaction.amount_fee directly (incorrect)
- Correct approach: Aggregate payouts by transaction_code, then use aggregated fees
- ✗ Audit doc B correctly identifies this as UNKNOWN; must be verified and corrected

**Status**: IMPLEMENTATION_ERROR (likely)

---

## Specification: Fee Incompleto Logic (Point 4)

### POWER_QUERY_RULE

```
if FeeRealTotal = null:
    FeeConsiderado = null

else if:
    payouts_total != null
    AND payouts_received != null
    AND payouts_received < payouts_total

then:
    FeeConsiderado = null

else:
    FeeConsiderado = FeeRealTotal
```

**Impact**: 
- Transaction continues contributing to: Qtd Transacoes 12M, Valor Bruto 12M
- Transaction does NOT contribute to: Qtd com Fee, Valor Base Taxa 12M, Fee Total 12M, TaxaFeeLinha

**Example**:
- Sale: R$100 with 2/3 payouts received
- payouts_received=66.67, payouts_total=100
- payouts_received < payouts_total → FeeConsiderado = null
- Sale still counts in: Qtd Transacoes 12M, Valor Bruto 12M = 100
- Sale does NOT count in fee metrics

| Field | PQ Rule | Audit Doc A | Current Code | MATCH | ISSUE |
|-------|---------|-------------|--------------|-------|-------|
| FeeConsiderado null logic | Precise 3-condition | Not described | Unknown | ? | MISSING_IN_SPEC |
| Partial payout handling | Excludes from fee only | Suggests full row exclusion | Likely wrong | ✗ | IMPLEMENTATION_ERROR |
| Qtd Transacoes still counted | YES | Incorrectly omitted | Likely wrong | ✗ | SPEC_ERROR |
| Valor Bruto still counted | YES | Incorrectly omitted | Likely wrong | ✗ | SPEC_ERROR |

**CORRECTIONS NEEDED**:
- ✗ FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md line 3.11 states "exclude transactions with incomplete payouts"
- This is WRONG per Power Query
- Correct: exclude ONLY from fee-related metrics, not from transaction count/value
- ✗ Test case needed: sale with 2/3 payouts must appear in Qtd/Valor but not in fee metrics

**Status**: BOTH_ERROR (spec wrong + code likely wrong)

---

## Specification: Taxa Média Ponderada (Point 5)

### POWER_QUERY_RULE

**WRONG formula** (audit doc uses this):
```
Taxa Media Ponderada = SUM(fee * amount) / SUM(amount)
```

**CORRECT formula**:
```
Taxa Media Ponderada = Fee Total 12M / Valor Base Taxa 12M
```

Where:
- Fee Total 12M = SUM(FeeConsiderado)
- Valor Base Taxa 12M = SUM(amount de linhas que possuem FeeConsiderado)

**Taxa Média Simples**:
```
Taxa Media Simples = AVERAGE(FeeConsiderado / amount)
```
Only rows where FeeConsiderado is not null

| Field | PQ Rule | Audit Doc A | Current Code | MATCH | ISSUE |
|-------|---------|-------------|--------------|-------|-------|
| Taxa Media Ponderada | Fee Total / Valor Base | Formula stated incorrectly | Unknown | ✗ | DOCUMENTATION_ERROR |
| Taxa Media Simples | AVERAGE(fee/amount) | Not distinguished | Unknown | ? | MISSING_IN_SPEC |
| Golden tests | Both metrics tested separately | Not mentioned | Likely missing | ✗ | SHOW_STOPPER |

**CORRECTIONS NEEDED**:
- ✗ FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md line 3.3 has wrong formula comment
- ✗ Code may be implementing wrong formula
- Create golden tests for BOTH metrics independently

**Status**: DOCUMENTATION_ERROR + IMPLEMENTATION_VERIFICATION_REQUIRED + TEST_REQUIRED

---

## Specification: Fallback de Taxas (Point 6)

### POWER_QUERY_RULE

**HIERARCHY for RECEBÍVEIS FUTUROS DE VENDAS JÁ REALIZADAS**:

**TIER 1 (Exact match)**: 
- Dimensions: payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan
- Condition: QtdComFee >= 5
- If no match → Tier 2

**TIER 2**:
- Dimensions: payment_type, nro_parcelas_modelo
- Does NOT include: card_type, entry_mode, payout_plan
- Condition: QtdFeeNivel2 >= 5
- If no match → Tier 3

**TIER 3**:
- Dimensions: payment_type ONLY
- Does NOT include: card_type
- Condition: QtdFeeNivel3 >= 5
- If no match → Tier 4

**TIER 4 (Global)**:
- No dimension filter
- Formula: SUM(Fee Total 12M) / SUM(Valor Base Taxa 12M)

| Field | PQ Rule | Audit Doc A | Current Code | MATCH | ISSUE |
|-------|---------|-------------|--------------|-------|-------|
| Tier 1 exact | 5D with Qtd>=5 | ✓ | Unknown | ? | VERIFY |
| Tier 2 | payment_type + parcelas | ✗ Listed as "payment_type + card_type + parcelas" | Unknown | ✗ | DOCUMENTATION_ERROR |
| Tier 3 | payment_type only | ✗ Listed as "payment_type + card_type" | Unknown | ✗ | DOCUMENTATION_ERROR |
| Tier 4 | Global average | ✓ | Unknown | ? | VERIFY |

**CORRECTIONS NEEDED**:
- ✗ FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md lists WRONG tier 2 and 3 definitions
- Remove: "tier 2 = payment_type + card_type + parcelas"
- Remove: "tier 3 = payment_type + card_type"
- ✗ Code must implement exact 4-tier hierarchy per Power Query

**Status**: DOCUMENTATION_ERROR

---

## Specification: Two Fee Hierarchies (Point 7)

### POWER_QUERY_RULE

**HIERARCHY A: RECEBÍVEIS DE VENDAS JÁ REALIZADAS** (4 tiers as in Point 6)

**HIERARCHY B: PROJEÇÃO DE VENDAS FUTURAS POR MODALIDADE**:
- Try: Taxa Media Ponderada exata
- Else: Fallback payment_type + nro_parcelas_modelo
- Else: Use 0
- Register: COMBINACAO_EXATA / MODALIDADE_E_PARCELAS / SEM_TAXA_HISTORICA

**DO NOT** reuse Hierarchy A (4 tiers) in Hierarchy B without semantic preservation

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Hierarchy A exists | 4 tiers | ✓ (Point 6) | Unknown | ? | VERIFY |
| Hierarchy B distinct | 2-3 tiers | Not mentioned | Unknown | ✗ | MISSING_IN_SPEC |
| Shared logic | Only if semantics preserved | Likely conflated | Unknown | ? | ARCHITECTURE_RISK |
| Registration | source field required | Not mentioned | Unknown | ✗ | MISSING_IN_SCHEMA |

**CORRECTIONS NEEDED**:
- ✗ Audit doc B does not distinguish two hierarchies
- Create separate service functions or clear parameter for hierarchy type
- Add source/origin field to distinguish fallback level

**Status**: DOCUMENTATION_ERROR + ARCHITECTURE_DECISION_REQUIRED

---

## Specification: Payout Amount Semantics (Point 8)

### POWER_QUERY_RULE

**Must be proven**:
- Does `sumup_payouts.amount_net` = "net payout amount after fee"?

**Correct semantics**:
```
Valor Recebivel Bruto API = ABS(Valor Evento API)
Fee Projetado = Valor Recebivel Bruto API * Taxa Projetada
Valor Recebivel Liquido = Valor Recebivel Bruto API - Fee Projetado
```

**Risk**: If amount_event is already net of fee, then subtracting fee again = double deduction

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| amount_net semantics | UNKNOWN - must verify | "net after fee" claimed without proof | Unknown | ? | SUMUP_AMOUNT_SEMANTICS_REVIEW_REQUIRED |
| Field classification | GROSS/NET/UNKNOWN | Not classified | Unknown | ✗ | MISSING_IN_SPEC |
| Fixture validation | API payload vs implementation | No fixture test | Unknown | ✗ | SHOW_STOPPER |

**CORRECTIONS NEEDED**:
- ✗ Classify each field: TRANSACTION_GROSS_AMOUNT, PAYOUT_AMOUNT, PAYOUT_FEE, EVENT_AMOUNT
- ✗ Create fixture test using REAL API payloads (or documented format)
- ✗ Verify: is amount already deducted or not?
- Mark as SUMUP_AMOUNT_SEMANTICS_REVIEW_REQUIRED until proven

**Status**: UNKNOWN_SEMANTICS (blocking)

---

## Specification: Perfil_Recebimento_12M (Point 9)

### POWER_QUERY_RULE

**Correct derivation** (NOT via transaction_events + dias/30):

**Source**:
- Transactions INNER JOIN Payouts on transaction_code
- Payout filters:
  - transaction_code != null
  - date != null
  - amount != null
  - status = SUCCESSFUL OR status IS NULL
  - type = PAYOUT OR type IS NULL

**Calculation**:
```
DataVendaMes = Date.StartOfMonth(Data Venda)
DataRecebimentoMes = Date.StartOfMonth(Data Recebimento Histórico)
Meses Ate Receber = (year(recebimento) - year(venda)) * 12 + month(recebimento) - month(venda)
MAX(0, result)
```

**Examples**:
- 31/01 → 01/02 = 1 month
- 01/01 → 31/01 = 0 months
- 28/02 → 01/03 = 1 month

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Source | JOIN via transaction_code | "via transaction_events" | Unknown | ✗ | IMPLEMENTATION_ERROR |
| Month calc | Year/month arithmetic | "dias / 30" formula | Unknown | ✗ | IMPLEMENTATION_ERROR |
| Edge cases | 31 Jan boundary | No tests | Unknown | ✗ | TEST_REQUIRED |

**CORRECTIONS NEEDED**:
- ✗ MIGRATION_0023_ARCHITECTURE_AUDIT.md incorrectly describes dias/30 approach
- Correct to: year*12 + month arithmetic
- ✗ Create golden tests for month boundaries
- ✗ Update schema if using transaction_events incorrectly

**Status**: BOTH_ERROR (spec unclear + code wrong)

---

## Specification: Profile Uses Absolute Value (Point 10)

### POWER_QUERY_RULE

```
Valor Recebido Absoluto = ABS(Valor Recebido Histórico)

Group by:
  payment_type, card_type, nro_parcelas_modelo, entry_mode, payout_plan,
  Meses Ate Receber

SUM(pct_recebimento_modalidade) = 1 per combination
```

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Absolute value | ABS() required | Not mentioned | Unknown | ? | VERIFY |
| Group by 6 dims | 5D + timing | Correct in schema | ✓ | ? | VERIFY |
| Invariant SUM=1 | Per modality | Not tested | Unknown | ✗ | TEST_REQUIRED |

**CORRECTIONS NEEDED**:
- Verify code uses ABS() on payout amounts
- Add invariant test: SUM(pct_recebimento_modalidade) = 1.0 per org/modality

**Status**: IMPLEMENTATION_VERIFICATION_REQUIRED + TEST_REQUIRED

---

## Specification: Sazonalidade Not 12M Only (Point 11)

### POWER_QUERY_RULE

**Two separate windows**:

**PERFIL HISTÓRICO POR MÊS** (uses available history, NOT limited to 12M):
- Build from full Transacoes history available
- For forecast of month M:
  1. Look SAME MONTH of PRIOR YEAR
  2. If not found: SAME MONTH MOST RECENT
  3. If not found: GLOBAL PROFILE
- GLOBAL uses: last 12M if available, else all available history

**Example**:
- Name like `sumup_seasonality_3bands_12m` may be semantically wrong if it prevents fallback to "same month more recent"

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Window limit | History-dependent, not fixed 12M | Table name implies 12M only | Unknown | ✗ | ARCHITECTURE_RISK |
| Fallback logic | 3-tier (year prior, recent, global) | Not described | Unknown | ✗ | MISSING_IN_SPEC |
| Data retention | Must keep >12M for fallbacks | May truncate | Unknown | ✗ | IMPLEMENTATION_RISK |

**CORRECTIONS NEEDED**:
- ✗ Table name `sumup_seasonality_3bands_12m` is misleading
- ✗ Must test fallback logic: year-prior → recent → global
- ✗ Code must NOT limit to 12M if that prevents "same month recent"

**Status**: DOCUMENTATION_ERROR + IMPLEMENTATION_RISK

---

## Specification: Sazonalidade Revenue Uses Refunds (Point 12)

### POWER_QUERY_RULE

```
Receita Histórica = MAX(0, amount - refunded_amount)

Filters:
  type = PAYMENT
  status = SUCCESSFUL
  amount > 0
```

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Refund deduction | MAX(0, amt - refund) | Not mentioned | Unknown | ? | VERIFY |
| Type filter | PAYMENT | Assumed | ? | ? | VERIFY |
| Status filter | SUCCESSFUL | Assumed | ? | ? | VERIFY |

**CORRECTIONS NEEDED**:
- Verify code subtracts refunded_amount
- Add test: sale with R$100, refund R$20 → revenue = R$80

**Status**: IMPLEMENTATION_VERIFICATION_REQUIRED + TEST_REQUIRED

---

## Specification: Three Bands Always Exist (Point 13)

### POWER_QUERY_RULE

```
Even if a band has zero revenue:

Create: Faixa 1, Faixa 2, Faixa 3

If Receita Histórica Mês > 0:
  peso = receita_faixa / receita_mês

Else (mes=0):
  peso = 1/3 for each band
```

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Empty band handling | Create with peso=1/3 | Not described | Unknown | ✗ | TEST_REQUIRED |
| Month with zero revenue | All bands get 1/3 | Not described | Unknown | ✗ | TEST_REQUIRED |

**CORRECTIONS NEEDED**:
- Add golden test: Month with one empty band
- Verify: all 3 bands returned even if one has 0 revenue

**Status**: TEST_REQUIRED

---

## Specification: Two Types of Receivables (Point 14)

### POWER_QUERY_RULE

**A. EXISTING_SALE_FUTURE_RECEIVABLE**:
- Sale already happened (SumUp API)
- Source: transaction_events
- Nature: Real sales, just not yet received

**B. PROJECTED_SALES_RECEIPT**:
- Sale hasn't happened yet
- Source: forecast → sazonalidade → mix → fee → timing
- Nature: Forecast-derived, projected cash

**CRITICAL**: Do NOT mix both indiscriminately in same table without discriminator

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Discriminator | Must exist (source/nature) | `sumup_future_receivables` for both? | Unknown | ✗ | ARCHITECTURE_ERROR |
| A: source | sumup_transactions + events | ✓ for A | ? | ? | VERIFY |
| B: source | forecast pipeline | ? for B | Unknown | ✗ | VERIFY |
| Versioning | forecast_version_id for B | Not in schema | Unknown | ✗ | MISSING_COLUMN |

**CORRECTIONS NEEDED**:
- ✗ Audit doc B does not distinguish Entity A from B
- ✗ Must add discriminator: source = 'SUMUP' | 'FORECAST'
- ✗ If both in same table: add nature and source_event_id
- OR split into two tables: sumup_future_receivables + forecast_cash_receipts

**Status**: ARCHITECTURE_ERROR (both types conflated)

---

## Specification: Schedule de Recebíveis (Point 15)

### POWER_QUERY_RULE

**Select transactions**:
- PAYMENT
- SUCCESSFUL
- payouts_total > payouts_received

**Then fetch transaction_events**:
- event_type = PAYOUT
- Status accepted: SCHEDULED, PENDING, RECONCILED

**Fields**:
- Installment Number
- Event Status
- Due Date (Data Recebimento Prevista)
- Actual Date (Data Efetiva Payout)
- Event Amount (Valor Evento API)
- Receipt Status (Situacao Recebimento)

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| TX filter | payouts_total > received | ✓ | ? | ? | VERIFY |
| Event source | transaction_events | Implied | ? | ? | VERIFY |
| Event statuses | 3: SCHEDULED, PENDING, RECONCILED | Not listed | Unknown | ✗ | MISSING_IN_SPEC |

**CORRECTIONS NEEDED**:
- Verify which statuses are used in events
- Test: transaction with 3 parcels, 1 realized + 2 scheduled

**Status**: IMPLEMENTATION_VERIFICATION_REQUIRED

---

## Specification: RECONCILED Status (Point 16)

### POWER_QUERY_RULE

**RECONCILED is NOT simple state**:
- Include in open events set (along with SCHEDULED, PENDING)
- But requires explicit semantic review
- Risk: Could conflict with payout SUCCESSFUL

**Action**: Mark as SUMUP_RECONCILED_SEMANTICS_REVIEW_REQUIRED

**Golden test mandatory**:
- Transaction with event RECONCILED
- Verify: No double-count with payout SUCCESSFUL

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| RECONCILED logic | Include in open set | Not described | Unknown | ? | REVIEW_REQUIRED |
| Double-count risk | Test mandatory | No test mentioned | Unknown | ✗ | TEST_REQUIRED |

**CORRECTIONS NEEDED**:
- Add RECONCILED to accepted statuses documentation
- Create golden test: reconciled event does NOT double-count

**Status**: SEMANTICS_REVIEW_REQUIRED + TEST_REQUIRED

---

## Specification: Simples Boundaries (Point 17)

### POWER_QUERY_RULE

**Correct boundaries** (NOT 1.5M, 2.4M):
```
180000       (bracket 1)
360000       (bracket 2)
720000       (bracket 3)
1800000      (bracket 4)
3600000      (bracket 5)
4800000      (bracket 6)
> 4800000    (out of scope)
```

**Test requirement** (each boundary):
```
boundary - 0.01
boundary
boundary + 0.01
```

**Example**:
```
179999.99 / 180000.00 / 180000.01
359999.99 / 360000.00 / 360000.01
... (all 7 brackets)
4799999.99 / 4800000.00 / 4800000.01
```

**Validate**:
- Faixa (bracket)
- Alíquota Nominal
- Parcela a Deduzir
- Alíquota Efetiva
- Status Tributário

| Field | PQ Rule | Audit Doc A | Current Code | MATCH | ISSUE |
|-------|---------|-------------|--------------|-------|-------|
| Boundaries | 7 values as listed | "1.5M, 2.4M" wrong | Unknown | ✗ | DOCUMENTATION_ERROR |
| Test coverage | 3 per boundary (21 total) | Not mentioned | Unknown | ✗ | TEST_REQUIRED |

**CORRECTIONS NEEDED**:
- ✗ FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md line 11.5 has wrong boundaries
- Replace with correct 7 boundaries
- Create 21-test suite for boundaries

**Status**: DOCUMENTATION_ERROR + TEST_REQUIRED

---

## Specification: RBT12 Rolling (Point 18)

### POWER_QUERY_RULE

**First competence**: Uses 12 prior realized months

**Rolling window**:
- Each subsequent competence uses: [competence_date - 12 months, competence_date)
- Current month is NEVER included in its own RBT12

**Test requirement**: 15-month dataset

For each month, prove:
- Which 12 competencies entered RBT12
- No current month included

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Window | [D-12M, D) | Not described | Unknown | ? | VERIFY |
| Current month excluded | YES | Not described | Unknown | ? | TEST_REQUIRED |
| 15-month dataset | Minimum | Not mentioned | Unknown | ✗ | TEST_REQUIRED |

**CORRECTIONS NEEDED**:
- Create 15-month golden dataset
- Verify rolling window month-by-month
- Test: Sept competence uses [Sept prior yr, Aug current]

**Status**: TEST_REQUIRED

---

## Specification: Simples Revenue Source (Point 19)

### POWER_QUERY_RULE

**Historical revenue** (actual):
- PAYMENT
- SUCCESSFUL
- MAX(0, amount - refunded_amount)

**Forecast revenue** (projected):
- Use forecast value
- NOT payout as revenue
- NOT cash entry as competence

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Historical source | Transactions | ✓ | ✓ | ✓ | OK |
| Refund treatment | Deduct | Not mentioned | Unknown | ? | VERIFY |
| Forecast source | Forecast entry | ✓ | ? | ? | VERIFY |
| Payout not revenue | Clear rule | Not stated | Unknown | ? | VERIFY |

**CORRECTIONS NEEDED**:
- Verify: refunds are deducted from taxable revenue
- Verify: payout is NOT used as revenue base

**Status**: VERIFICATION_REQUIRED

---

## Specification: Tiny Payables (Point 20)

### POWER_QUERY_RULE

**Verify current implementation**:
- Endpoint used
- Semantic entity (Accounts Payable, not Receivable)
- Field mapping documented

**For future obligation**:
```
Valor = 1000
Saldo = 600
Situacao = parcial

ValorPago = 400
ValorAberto = 600
```

**Ledger entry**: SAÍDA 600 (only open amount)

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| System | Tiny/Olist AP | "accounts-payable.ts" exists | ? | ? | VERIFY |
| Endpoint doc | Current API | Not documented | Unknown | ✗ | MISSING_DOC |
| Entity | AP, not AR | Implied | ? | ? | VERIFY |
| Saldo calc | valor - pago | Not described | Unknown | ? | VERIFY |

**CORRECTIONS NEEDED**:
- Document: which Tiny endpoint is used
- Verify: ValorAberto = Valor - ValorPago
- Ledger entry test: Only saldo enters ledger, not valor

**Status**: VERIFICATION_REQUIRED + DOCUMENTATION_REQUIRED

---

## Specification: Accounts Receivable Source (Point 21)

### POWER_QUERY_RULE

**Must audit**:
- Matrix associates AR to Tiny/Olist invoices
- But Power Query spec only mentions AP
- True source of AR may be different

**Action**: Audit actual implementation

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| AR source | UNKNOWN (needs audit) | Tiny implied | Unknown | ? | ARCHITECTURE_AUDIT |
| AP source | Tiny confirmed | ✓ | ? | ? | VERIFY |

**CORRECTIONS NEEDED**:
- Search codebase for AR source
- Verify: are they Tiny invoices or OList orders?
- Document: AR source of truth

**Status**: ARCHITECTURE_AUDIT_REQUIRED

---

## Specification: Ledger Architecture (Point 22)

### POWER_QUERY_RULE

Two options; none are yet chosen:

**Option A: VIRTUAL/DERIVED LEDGER**:
- VIEW over normalized sources
- Always consistent
- No stale state
- Forecast versionable via query

**Option B: PERSISTED PROJECTION**:
- Recalculable/idempotent
- Must have: source, source_id, source_event_id, projection_version_id, calculation_version, generated_at, valid_from, superseded_at

**Decision required**: Choose A or B before proceeding

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Architecture | A or B chosen | B assumed (table exists) | TABLE | ? | DECISION_REQUIRED |
| Idempotency | Required if B | Not designed | Unknown | ✗ | ARCHITECTURE_RISK |
| Versioning | Explicit in B | Not in schema | Unknown | ✗ | MISSING_COLUMNS |

**CORRECTIONS NEEDED**:
- Make explicit decision: A (VIEW) or B (TABLE with versioning)
- If B: add versioning columns
- If A: convert to VIEW, add calc at query time

**Status**: ARCHITECTURE_DECISION_REQUIRED

---

## Specification: Append-Only Contradiction (Point 23)

### POWER_QUERY_RULE

**Current state**: Described as append-only/immutable

**Requirement**: Replace scheduled→actual, forecast updates

**Contradiction**: Cannot be both

**Solutions**:
1. VERSIONED EVENTS (append-only, but events have version)
2. CURRENT SNAPSHOT (table holds current state, versioned)
3. DETERMINISTIC VIEW (computed on demand)

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Semantic | Mutable vs immutable | Contradicts ledger | TABLE | ✗ | DESIGN_CONFLICT |
| Strategy | One of 3 chosen | Not chosen | Unknown | ✗ | DECISION_REQUIRED |

**CORRECTIONS NEEDED**:
- Resolve contradiction: choose strategy
- Document: when scheduled→actual, how is it handled?
- No silent DELETE + INSERT

**Status**: DESIGN_CONFLICT_REQUIRED

---

## Specification: Forecast Dedup (Point 24)

### POWER_QUERY_RULE

**No 1:1 relationship** between:
- Individual forecast entry
- Realized SumUp sale

**Forecast is aggregated**; actualization is temporal/competency-based

**Key definition required**:
- forecast_horizon
- cutoff
- actualization_rule

**Blockers**:
- FORECAST_ACTUALIZATION_RULE_REQUIRES_BUSINESS_DEFINITION

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Relationship | None; aggregated | Not described | Unknown | ✗ | MISSING_RULE |
| Actualization | Temporal, not 1:1 | Not defined | Unknown | ✗ | BUSINESS_DECISION |
| Double-count prevention | Via temporal rules | Via fake ID? | Unknown | ✗ | RISK |

**CORRECTIONS NEEDED**:
- Define: When forecast period closes with actual sales, how does forecast get updated?
- Answer: Do we reduce forecast? Preserve forecast and track variance? Delete?
- Block: FORECAST_ACTUALIZATION_RULE_REQUIRES_BUSINESS_DEFINITION

**Status**: BUSINESS_RULE_REQUIRED

---

## Specification: CMV (Point 25)

### POWER_QUERY_RULE

**Current status**: ZERO comprovable rule in Power Query

**Classification**: BLOCKED_BUSINESS_RULE

**Status**: CMV not implemented; not a validation blocker

| Field | PQ Rule | Audit Doc A | Current Code | MATCH | ISSUE |
|-------|---------|-------------|--------------|-------|-------|
| CMV rule | None found | Marked "unverified" | Unknown | ✗ | BLOCKED |

**CORRECTIONS NEEDED**:
- ✗ FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md line 16 should mark CMV as BLOCKED_BUSINESS_RULE
- NOT as IMPLEMENTED_UNVERIFIED
- Exclude CMV from parity denominat or until rule exists

**Status**: BLOCKED_BUSINESS_RULE (correct, but mis-classified in audit)

---

## Specification: Table Architecture Decisions (Point 26)

### POWER_QUERY_RULE

**Five tables need decisions**:

1. **sumup_fee_rates_12m**: 
   - Decision: KEEP_TABLE + refresh job OR CONVERT_TO_MV
   - Issue: No refresh logic defined

2. **sumup_seasonality_3bands_12m**:
   - Decision: KEEP_TABLE + monthly refresh OR CONVERT_TO_MV
   - Issue: Invariant SUM(peso)=1 not tested

3. **sumup_receipt_profile_12m**:
   - Decision: KEEP_TABLE + refresh OR CONVERT_TO_MV
   - Issue: Invariant SUM(pct)=1 not tested

4. **sumup_future_receivables**:
   - Decision: KEEP_TABLE + sync logic OR CONVERT_TO_VIEW
   - Issue: Population logic undefined

5. **financial_ledger**:
   - Decision: Define insertion workflow
   - Issue: No deduplication strategy

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Decision made | Not specified | Assumptions only | Unknown | ✗ | DECISION_REQUIRED |
| Refresh logic | Not in PQ | Not implemented | Unknown | ✗ | SHOW_STOPPER |
| Invariants | Not in PQ | Audit identifies | Unknown | ✗ | TEST_REQUIRED |

**CORRECTIONS NEEDED**:
- Make explicit decision for each table (per Point 27 default preference)
- Implement refresh/sync logic
- Add invariant tests

**Status**: ARCHITECTURE_DECISIONS_REQUIRED

---

## Specification: Initial Architecture Preference (Point 27)

### POWER_QUERY_RULE (stated as hypothesis)

**sumup_fee_rates_12m**: 
- Materialized View OR refreshable table
- If volume justifies

**sumup_seasonality_3bands_12m**:
- View/MV OR structure keeping historical fallbacks

**sumup_receipt_profile_12m**:
- View/MV derived from transactions + payouts

**sumup_future_receivables**:
- View/service over transaction events if performance allows
- Allows rapid refresh

**financial_ledger**:
- Regenerable/idempotent canonical layer
- NOT irreversible copy of external systems

**Criteria for decision**:
- Correctness
- Freshness
- Idempotency
- Lineage
- Query cost
- Update frequency
- Data volume
- Tenant isolation

| Field | PQ Rule | Audit Doc B | Current Code | MATCH | ISSUE |
|-------|---------|------------|--------------|-------|-------|
| Default choice | Hypothesis | Not all tabled | TABLE (all) | ✗ | REVIEW_NEEDED |
| Performance test | Required | Not done | Unknown | ✗ | TEST_REQUIRED |

**CORRECTIONS NEEDED**:
- Audit doc B correctly identifies: choices not yet made
- Test performance of each option
- Choose per criteria

**Status**: DECISION_REQUIRED

---

## Summary Table: All 48 Points

| Point | Area | PQ Rule | Audit A | Audit B | Code | Status |
|-------|------|---------|---------|---------|------|--------|
| 1-4 | Taxas_12M | Clear | Partial | Partial | UNKNOWN | VERIFICATION_REQUIRED |
| 3 | Fee source | Clear | WRONG | UNKNOWN | UNKNOWN | IMPLEMENTATION_ERROR |
| 4 | Fee incompleto | Clear | WRONG | N/A | UNKNOWN | BOTH_ERROR |
| 5 | Taxa média | Clear | WRONG | N/A | UNKNOWN | DOCUMENTATION_ERROR |
| 6 | Fallback tiers | Clear | WRONG | N/A | UNKNOWN | DOCUMENTATION_ERROR |
| 7 | Two hierarchies | Clear | MISSING | N/A | UNKNOWN | MISSING_IN_SPEC |
| 8 | Payout semantics | UNKNOWN | CLAIMED | UNKNOWN | UNKNOWN | BLOCKING |
| 9 | Receipt profile | Clear | WRONG | WRONG | UNKNOWN | BOTH_ERROR |
| 10 | Absolute value | Clear | MISSING | MISSING | UNKNOWN | VERIFICATION_REQUIRED |
| 11 | Sazonalidade window | Clear | WRONG | WRONG | UNKNOWN | BOTH_ERROR |
| 12 | Sazon revenue | Clear | MISSING | MISSING | UNKNOWN | TEST_REQUIRED |
| 13 | 3 bands always | Clear | MISSING | MISSING | UNKNOWN | TEST_REQUIRED |
| 14 | Two receivables | Clear | CONFLATED | CONFLATED | UNKNOWN | ARCHITECTURE_ERROR |
| 15 | Schedule | Clear | MISSING | MISSING | UNKNOWN | VERIFICATION_REQUIRED |
| 16 | RECONCILED | Clear | MISSING | MISSING | UNKNOWN | SEMANTICS_REVIEW |
| 17 | Simples boundaries | Clear | WRONG | N/A | UNKNOWN | DOCUMENTATION_ERROR |
| 18 | RBT12 rolling | Clear | MISSING | N/A | UNKNOWN | TEST_REQUIRED |
| 19 | Simples revenue | Clear | OK | OK | UNKNOWN | VERIFICATION_REQUIRED |
| 20 | Tiny payables | Clear | MISSING | IMPLIED | UNKNOWN | VERIFICATION_REQUIRED |
| 21 | AR source | Clear | MISSING | IMPLIED | UNKNOWN | ARCHITECTURE_AUDIT |
| 22 | Ledger arch | Clear | A vs B? | B assumed | B (TABLE) | DECISION_REQUIRED |
| 23 | Append-only | Explicit choice | CONFLICT | CONFLICT | B (MUTABLE) | DESIGN_CONFLICT |
| 24 | Forecast dedup | Temporal rules | MISSING | MISSING | UNKNOWN | BUSINESS_RULE |
| 25 | CMV | NONE | WRONG | N/A | UNKNOWN | BLOCKED |
| 26 | Table decisions | Not specified | Assumed | Assumed | UNKNOWN | DECISION_REQUIRED |
| 27 | Architecture pref | Hypothesis | Noted | Noted | UNKNOWN | TEST_REQUIRED |
| 28-30 | Documentation | Specification | To update | To update | — | DOCS_UPDATE |
| 31-40 | Golden datasets | 10 datasets | None | None | None | SHOW_STOPPER |
| 41 | RLS/Auth | Per 48 pts | Partially | Partially | UNKNOWN | VERIFICATION_REQUIRED |
| 42 | Timeouts | Must be 0 | Last: 11 | Last: 11 | Unknown | CRITICAL_CHECK |
| 43 | Migration 0023 | Not approved | State unknown | State unknown | APPLIED_LOCAL | VERIFY_STATE |
| 44-47 | Commits/validation | Per plan | — | — | — | PROCESS |

---

## Critical Path Blockers

| Blocker | Impact | Resolution |
|---------|--------|-----------|
| **PAYOUT_AMOUNT_SEMANTICS** (Point 8) | Cannot calculate fees correctly | Audit SumUp API documentation + fixtures |
| **FEE_DERIVATION** (Point 3) | Wrong fee in all forecasts | Fix: Use aggregated payouts, not transaction fee |
| **FORECAST_ACTUALIZATION_RULE** (Point 24) | Cannot prevent double-count forecast→actual | Business decision required |
| **LEDGER_ARCHITECTURE** (Points 22-23) | Unknown if append-only or mutable | Choose: VIEW vs TABLE with versioning |
| **SIMPLES_BOUNDARIES** (Point 17) | Tax calculations wrong if boundaries wrong | Update from 1.5M/2.4M to correct 7 values |
| **GOLDEN_DATASETS** (Points 31-40) | No mathematical proof | Create 10 deterministic datasets with expected values |

---

## Recommendations

### Immediate (Blocking Validation)

1. **Resolve PAYOUT_AMOUNT_SEMANTICS** (Point 8)
   - Read SumUp API docs for sumup_payouts.amount semantics
   - Create fixture test with real API response format
   - Classify: GROSS / NET / UNKNOWN
   - Block: SUMUP_AMOUNT_SEMANTICS_REVIEW_REQUIRED until resolved

2. **Fix Fee Derivation** (Point 3)
   - Verify code uses: Payouts grouped by transaction_code, not transaction.amount_fee
   - If wrong: create service to aggregate correctly
   - Test: fee calculated correctly from payout data

3. **Correct Simples Boundaries** (Point 17)
   - Update FINANCIAL_PARITY_REQUIREMENTS_MATRIX.md
   - Replace 1.5M/2.4M with: 180k, 360k, 720k, 1.8M, 3.6M, 4.8M
   - Create 21-test suite for boundaries

4. **Choose Ledger Architecture** (Points 22-23)
   - Decide: VIEW (A) or TABLE with versioning (B)
   - If B: add columns (source_id, projection_version_id, etc.)
   - Document: deduplication strategy

### Phase 2 (Architecture)

5. **Define Forecast Actualization Rule** (Point 24)
   - Business decision: What happens when forecast month realizes?
   - Options: Reduce forecast, track variance, delete old, preserve both
   - Document in business rules

6. **Fix Receipt Profile Derivation** (Point 9)
   - Change from: dias / 30
   - Change to: (year*12 + month) arithmetic
   - Update: MIGRATION_0023_ARCHITECTURE_AUDIT.md

7. **Implement Architecture Decisions** (Points 26-27)
   - For each of 5 tables: decide TABLE vs VIEW vs MV
   - Implement refresh logic for derived tables
   - Add invariant tests

### Phase 3 (Golden Tests)

8. **Create 10 Golden Datasets** (Points 31-40)
   - Taxas_12M (Caso A, B, C with partial payouts)
   - Fallback tiers (exact, tier 2, tier 3, global)
   - Sazonalidade (historical month, weights, boundary)
   - Payment mix (split by type)
   - Receipt profile (timing distribution)
   - Full pipeline (forecast → cash receipts)
   - Existing sale receivables (scheduled → actual)
   - Simples (7 brackets)
   - Tiny payables (partial open amount)
   - Cash flow (integration)

---

## Next Steps

**SPEC_CORRECTION_AUDIT Status**: COMPLETE

**Next**: CODE AUDIT against this specification

**Then**: Create corrections + golden tests

**Finally**: Validation pass

---

**Audit Version**: POWER_QUERY_SPEC_VERSION = LEGACY_EXCEL_PARITY_V1  
**Audit Date**: 2026-09-01  
**Next Review**: After code corrections
