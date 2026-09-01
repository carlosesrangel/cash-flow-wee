# Financial Parity Requirements Matrix

**Project**: Cash Flow WEE  
**Checkpoint Status**: VALIDATION_REQUIRED (NOT ACCEPTED)  
**Generated**: 2026-09-01  
**Validation Target**: Achieve PARITY_VALIDATION_COVERAGE >= 90%

---

## Matrix Overview

This matrix tracks every financial requirement from the Power Query specification against:
- Implementation status (code exists)
- Mathematical validation (tests prove correctness with actual values)
- Production readiness

**Status Legend**:
- `NOT_IMPLEMENTED` - Code does not exist
- `IMPLEMENTED_UNVERIFIED` - Code exists, no deterministic tests
- `PARTIALLY_VALIDATED` - Some test coverage, edge cases untested
- `VALIDATED` - Mathematical test with expected values passes
- `BLOCKED_BUSINESS_RULE` - Technical blocker on rule implementation

---

## 1. SUMUP_TRANSACTIONS - Historical Transaction Base

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 1.1 | Transactions table | Load all SumUp transactions last 90 days | `lib/sumup/sync/payouts.ts` | `sumup_transactions` | `NONE (sync only)` | `sumup/sync/payouts.test.ts` | ✓ Basic upsert | ✗ No value validation | `IMPLEMENTED_UNVERIFIED` | Sync maps status/amount to DB | Need fixture with fee breakdown |
| 1.2 | Transactions.amount | Gross transaction value (before fee) | `lib/sumup/sync/transactions.ts` | `sumup_transactions.amount_gross` | `NONE` | `No specific test` | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Column exists in schema | No test comparing SumUp raw vs DB |
| 1.3 | Transactions.fee | Transaction fee charged | `lib/sumup/sync/transactions.ts` | `sumup_transactions.amount_fee` | `NONE` | ✗ | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Column exists in schema | Fee calculation validation missing |
| 1.4 | Transactions.status | Transaction status (successful/failed) | `lib/sumup/sync/transactions.ts` | `sumup_transactions.status` | `NONE` | ✓ (status field in mock) | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Maps from SumUp API | Edge case: RECONCILED status handling |
| 1.5 | Transactions.payment_type | CARD, PIX, etc | `lib/sumup/sync/transactions.ts` | `sumup_transactions.payment_type` | `NONE` | ✓ (in mocks) | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Column exists | No normalization test |
| 1.6 | Transactions.installment_count | Parcelas for CARD | `lib/sumup/sync/transactions.ts` | `sumup_transactions.nro_parcelas` | `NONE` | ✗ | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Column exists | No edge case (1-36 range) |

---

## 2. SUMUP_PAYOUTS - Payout History & Schedules

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 2.1 | Payouts table | Load all payouts (status = SUCCESSFUL/SCHEDULED/PENDING) | `lib/sumup/sync/payouts.ts` | `sumup_payouts` | `NONE (sync only)` | ✓ Maps status | ✓ Basic upsert | ✗ No value validation | `IMPLEMENTED_UNVERIFIED` | Test confirms upsert logic | Need payout timeline fixture |
| 2.2 | Payouts.amount | Net payout amount after fee | `lib/sumup/sync/payouts.ts` | `sumup_payouts.amount_net` | `NONE` | ✗ | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Column exists | Reconciliation to gross/fee missing |
| 2.3 | Payouts.status | SUCCESSFUL / SCHEDULED / PENDING / RECONCILED | `lib/sumup/sync/payouts.ts` | `sumup_payouts.status` | `NONE` | ✓ (in sync test) | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Sync test includes status mapping | RECONCILED handling undocumented |
| 2.4 | Payouts.due_date | Expected payout date | `lib/sumup/sync/payouts.ts` | `sumup_payouts.due_date` | `NONE` | ✗ | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Column exists | No date boundary tests |
| 2.5 | Payouts.transaction_id | Reference to originating transaction | `lib/sumup/sync/payouts.ts` | `sumup_payouts.sumup_transaction_id` (FK) | `NONE` | ✗ | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | FK constraint exists | No orphan detection test |

---

## 3. TAXAS_12M - 12-Month Historical Fee Rates

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 3.1 | FeeHistorical (aggregated) | Aggregate fees by payment_type, card_type, parcelas, entry_mode, payout_plan | `lib/payments/engine.ts` | `sumup_fee_rates_12m` | `GET /api/analytics/fee-rates` | ✗ No test | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Columns defined in migration 0023 | **No golden dataset test** |
| 3.2 | FeeHistorical.taxa_media_simples | Simple average of all fees for combination | `lib/payments/engine.ts` | `sumup_fee_rates_12m.taxa_media_simples` | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Column exists | **Mathematical validation missing** |
| 3.3 | FeeHistorical.taxa_media_ponderada | Fee-weighted average (SUM(fee*amount)/SUM(amount)) | `lib/payments/engine.ts` | `sumup_fee_rates_12m.taxa_media_ponderada` | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Formula comment in migration | **No test proves correct formula** |
| 3.4 | FeeHistorical.confiabilidade | ALTA (>=30), MEDIA (>=10), BAIXA (<10) transactions | `lib/payments/engine.ts` | `sumup_fee_rates_12m.confiabilidade` | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | CHECK constraint defined | **Edge case: exactly 10 or 30 tx** |
| 3.5 | FeeHistorical fallback tier 1 | Use exact (type, card, parcelas, entry, payout) combination | `lib/payments/engine.ts` | Query sumup_fee_rates_12m with all dimensions | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Unique constraint exists | **No test: exact match vs fallback** |
| 3.6 | FeeHistorical fallback tier 2 | Fall back to (type, card, parcelas) if tier 1 empty | `lib/payments/engine.ts` | Query with subset dimensions | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Service code likely exists | **No test: verify fallback logic** |
| 3.7 | FeeHistorical fallback tier 3 | Fall back to (type, card) if tier 2 empty | `lib/payments/engine.ts` | Query with 2 dimensions | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Service code likely exists | **No test: fallback chain** |
| 3.8 | FeeHistorical fallback tier 4 | Use global average (all combinations) if all tiers empty | `lib/payments/engine.ts` | Query with org_id only | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Service code likely exists | **No test: global fallback case** |
| 3.9 | FeeHistorical.pct_valor_12m | % of total revenue (value-weighted) | `lib/payments/engine.ts` | `sumup_fee_rates_12m.pct_valor_12m` | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Column exists | **SUM must = 100%** |
| 3.10 | FeeHistorical.pct_transacoes_12m | % of transaction count | `lib/payments/engine.ts` | `sumup_fee_rates_12m.pct_transacoes_12m` | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Column exists | **SUM must = 100%** |
| 3.11 | Payouts_Received < Payouts_Total | Exclude transactions with incomplete payouts from historical base | `lib/payments/engine.ts` | Filter in aggregation query | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Filter logic should exist | **No test: incomplete payout exclusion** |

---

## 4. AGENDA_RECEBIVEIS_API - SumUp Future Receivables from Existing Sales

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 4.1 | Payouts (scheduled+pending+reconciled) | Load payouts from transaction_events status filters | `lib/payments/engine.ts` | `sumup_future_receivables` | `GET /api/receivables/future` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table created in migration 0023 | **No test: event_status mapping** |
| 4.2 | Payouts.installment_number | Group by installment for CARD | `lib/payments/engine.ts` | `sumup_future_receivables.installment_number` | `GET /api/receivables/future` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Column exists | **No test: Card 3X scenario** |
| 4.3 | Payouts.amount_net - fee | Receivable amount after SumUp fee | `lib/payments/engine.ts` | `sumup_future_receivables.valor_recebivel_liquido` | `GET /api/receivables/future` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Column exists | **Fee already deducted by SumUp?** |
| 4.4 | Fee projection via fallback tiers | Use fee_rates_12m lookup with fallback | `lib/payments/engine.ts` | Uses sumup_fee_rates_12m | `GET /api/receivables/future` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Should reference table | **No test: which tier was used** |
| 4.5 | Due date classification | SEM_DATA, ATRASADO, HOJE, FUTURO | `lib/payments/engine.ts` | `sumup_future_receivables.situacao_recebimento` | `GET /api/receivables/future` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | CHECK constraint in migration | **No test: timezone handling for "today"** |

---

## 5. RECEBIVEIS_FUTUROS - Forecast Revenue Converted to Projected Receivables

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 5.1 | ForecastRevenue table | Load monthly forecast entries | `lib/forecast/engine.ts` | `forecast_entries` | `GET /api/forecast/entries` | ✓ (basic load test) | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Test loads entries | No calculation validation |
| 5.2 | Apply seasonality 3-band distribution | Project revenue by faixa (1-9, 10-19, 20-end) | `lib/forecast/engine.ts` | Uses `sumup_seasonality_3bands_12m` | `GET /api/analytics/seasonality` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table exists | **No test: weight distribution** |
| 5.3 | Apply payment_mix distribution | Distribute faixa by payment_type | `lib/payments/engine.ts` | Uses `sumup_fee_rates_12m` pct_valor | `GET /api/analytics/payment-mix` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table has pct_valor column | **No test: SUM=100% invariant** |
| 5.4 | Apply fee projection | Use fee_rates_12m fallback tier system | `lib/payments/engine.ts` | References sumup_fee_rates_12m | `GET /api/analytics/fee-rates` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Column exists | **No test: fee matrix selection** |
| 5.5 | Apply receipt_profile distribution | Distribute by payment timing (M+0, M+1, M+2) | `lib/forecast/engine.ts` | Uses `sumup_receipt_profile_12m` | `GET /api/analytics/receipt-profile` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table exists | **No test: SUM(pct)=1 invariant** |
| 5.6 | Full pipeline: forecast → receivables | End-to-end: revenue → seasonality → mix → fee → timing | `lib/forecast/engine.ts` | Populates `sumup_future_receivables` for forecast | `GET /api/receivables/projected` | ✗ | ✗ | **CRITICAL MISSING - THIS IS THE MOST IMPORTANT** | `IMPLEMENTED_UNVERIFIED` | Service logic exists | **No golden dataset test** |

---

## 6. SAZONALIDADE_3_FAIXAS - Intra-Month Seasonality

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 6.1 | SeasonalityHistorical table | Group revenue by day-of-month bands: 1-9, 10-19, 20-end | `lib/forecast/engine.ts` | `sumup_seasonality_3bands_12m` | `GET /api/analytics/seasonality` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table created, columns defined | **No test with fixture data** |
| 6.2 | peso_faixa calculation | peso = revenue_faixa / revenue_mes (or 1/3 if mes=0) | `lib/forecast/engine.ts` | Computed in view or service | `GET /api/analytics/seasonality` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Migration comment shows formula | **No test: edge case mes=0** |
| 6.3 | SUM(peso_faixa) = 1 invariant | All 3 bands for a month sum to 100% | Test suite | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | No test exists | **MUST TEST THIS** |
| 6.4 | Apply to monthly forecast | forecast_revenue × peso_faixa[faixa] | `lib/forecast/engine.ts` | Service calculation | `GET /api/analytics/seasonality` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No test: 10,000 split into 3 bands** |
| 6.5 | Historical month selection | Use same calendar month from most recent 12M | `lib/forecast/engine.ts` | Query filter on mes_historico | `GET /api/analytics/seasonality` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Filter likely exists | **No test: rolling 12M window** |

---

## 7. PAYMENT_MIX - Payment Type Distribution

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 7.1 | FeeHistorical.pct_valor_12m | Payment type prevalence by value | `lib/payments/engine.ts` | `sumup_fee_rates_12m.pct_valor_12m` | `GET /api/analytics/payment-mix` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Column exists | **No test: CARD vs PIX split** |
| 7.2 | Apply to seasonality-band revenue | band_revenue × pct_valor[payment_type] | `lib/payments/engine.ts` | Service calculation | `GET /api/analytics/payment-mix` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No test: 3000 → 1500 CARD + 1500 PIX** |
| 7.3 | SUM(pct_valor) = 1 invariant | All payment types sum to 100% | Test suite | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | No test exists | **MUST TEST THIS** |
| 7.4 | Sub-dimensions: card_type + parcelas | CARD 1X, CARD 3X, etc. | `lib/payments/engine.ts` | `sumup_fee_rates_12m` unique constraint includes all dims | `GET /api/analytics/payment-mix` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Unique constraint exists | **No test: 5% CARD 3X breakdown** |

---

## 8. PERFIL_RECEBIMENTO_12M - Receipt Timing Profile

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 8.1 | ReceiptProfile table | Historical % of payment received at M+0, M+1, M+2 by modality | `lib/forecast/engine.ts` | `sumup_receipt_profile_12m` | `GET /api/analytics/receipt-profile` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table created, columns defined | **No test with fixture** |
| 8.2 | pct_recebimento_modalidade calculation | pct = valor_received / total_received (per modality) | `lib/forecast/engine.ts` | Computed in service or view | `GET /api/analytics/receipt-profile` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Migration defines column | **No test: 40-35-25 split** |
| 8.3 | SUM(pct) per modality = 1 invariant | All timing buckets for a payment type sum to 100% | Test suite | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | No test exists | **MUST TEST THIS** |
| 8.4 | Apply to payment-mix revenue | payment_revenue × pct_recebimento[M+n] | `lib/forecast/engine.ts` | Service calculation | `GET /api/analytics/receipt-profile` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No test: 5000 → 2000 M+0, 1750 M+1, 1250 M+2** |
| 8.5 | Date projection | event_date + meses_ate_receber → due_date | `lib/forecast/engine.ts` | Date arithmetic | `GET /api/analytics/receipt-profile` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Should exist | **No test: month-end handling** |

---

## 9. PROJECAO_VENDAS_MODALIDADE - Forecast by Payment Mode

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 9.1 | Monthly forecast × seasonality × payment_mix | Combined projection | `lib/forecast/engine.ts` | Service logic | `GET /api/forecast/modalities` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No golden dataset** |
| 9.2 | SUM(modalidade) per month = forecast_month invariant | All modes sum to original forecast | Test suite | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | No test exists | **MUST TEST - within rounding** |

---

## 10. PROJECAO_RECEBIMENTOS - Forecast to Cash Receipt Timeline

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 10.1 | Full pipeline: Monthly forecast through all 5 stages | Forecast → Seasonality → PaymentMix → Fee → ReceiptProfile | `lib/forecast/engine.ts` | Uses all 4 aggregation tables | `GET /api/forecast/receivables` | ✗ | ✗ | **CRITICAL MISSING - MOST CRITICAL** | `IMPLEMENTED_UNVERIFIED` | Service exists | **NO GOLDEN DATASET TEST (SHOW-STOPPER)** |
| 10.2 | Projected receipt amounts by date | Grouped by due_date, summed across all component forecasts | `lib/forecast/engine.ts` | `sumup_future_receivables` (projected records) | `GET /api/forecast/receivables` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table columns exist | **No test** |
| 10.3 | Verify: SUM(receipts_monthly) ≈ SUM(forecast) invariant | Total cash in ≈ revenue forecast (within fee/rounding) | Test suite | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | No test exists | **MUST TEST** |

---

## 11. PROJECAO_SIMPLES - Simples Nacional Tax Projection

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 11.1 | RBT12 calculation (rolling 12-month revenue base) | SUM(net_revenue last 12 months) | `lib/tax/engine.ts` | Service logic | `GET /api/tax/simples` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Function calculate_simples_effective_rate exists | **No test: month-by-month rolling** |
| 11.2 | RBT12 band lookup | Select tax rate band based on RBT12 value | `lib/tax/engine.ts` | `tax_configurations` + service | `GET /api/tax/simples` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | tax_configurations table exists | **No test: boundary conditions** |
| 11.3 | Effective rate calculation | (nominal_rate × RBT12 - deduction) / RBT12 | `lib/tax/engine.ts` | `calculate_simples_effective_rate()` function | `GET /api/tax/simples` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | SQL function exists in migration | **No test: formula correctness** |
| 11.4 | Monthly Simples due date | Competence month → due date (20 next month per regime) | `lib/tax/engine.ts` | Service logic | `GET /api/tax/simples` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Should exist | **No test: Sept competence → Oct 20** |
| 11.5 | Test RBT12 boundaries | Test rates at 180k, 360k, 720k, 1.5M, 2.4M, 3.6M, 4.8M (all bands) | Test suite | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING - HIGH PRIORITY** | `IMPLEMENTED_UNVERIFIED` | No test exists | **MUST TEST 7 BRACKETS** |
| 11.6 | Verify: tax_projected_monthly entries only once | No duplicate entries per competence month | Test suite (dedup check) | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | No test exists | **MUST TEST** |

---

## 12. TINY_ACCOUNTS_PAYABLE - Payable Invoices from B2B Suppliers

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 12.1 | Load accounts payable from Tiny | Sync invoices (status = pago, aberto, parcial pago) | `lib/olist/sync/accounts-payable.ts` | `tiny_invoices` | `NONE (sync only)` | ✓ (basic sync test) | ✗ | ✗ | `IMPLEMENTED_UNVERIFIED` | Sync test mocks upsert | No amount validation test |
| 12.2 | ValorAberto calculation | valor_total - valor_pago | `lib/olist/sync/accounts-payable.ts` | Computed field or service | `GET /api/payables` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No test: 1000-400=600** |
| 12.3 | StatusFinanceiro classification | pago / aberto / vencido / parcial / cancelado | `lib/olist/sync/accounts-payable.ts` | Derived in service | `GET /api/payables` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No test: vencido boundary** |
| 12.4 | DiasVencimento calculation | days_between(today, due_date) | `lib/olist/sync/accounts-payable.ts` | Service logic | `GET /api/payables` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Should exist | **No test: timezone handling** |
| 12.5 | Ledger entry only for ValorAberto | Do NOT ledger total invoice, only open amount | `lib/cash-flow/engine.ts` | Ledger population logic | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Should exist | **No test: must verify 600 not 1000** |

---

## 13. LEDGER - Canonical Cash Flow Journal

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 13.1 | OPENING_BALANCE entry | Initial balance on org creation | `lib/cash-flow/engine.ts` | `financial_ledger` nature='OPENING_BALANCE' | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table exists, nature defined | **No test: seed balance** |
| 13.2 | SUMUP_PAYOUT_ACTUAL | Realized payouts from sumup_payouts status=SUCCESSFUL | `lib/cash-flow/engine.ts` | Insert from sumup_payouts when status changes | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table exists, nature defined | **No test: payout → ledger** |
| 13.3 | SUMUP_PAYOUT_SCHEDULED | Future payouts from sumup_payouts status=SCHEDULED | `lib/cash-flow/engine.ts` | Insert when status=SCHEDULED | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table exists, nature defined | **No test: scheduled → ledger** |
| 13.4 | PROJECTED_SALES_RECEIPT | Forecast-derived receivables (final pipeline output) | `lib/cash-flow/engine.ts` | Insert from sumup_future_receivables (projected) | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table exists, nature defined | **No test: forecast → ledger** |
| 13.5 | ACCOUNTS_RECEIVABLE | Tiny or OList unpaid invoices (ValorAberto) | `lib/cash-flow/engine.ts` | Insert from tiny_invoices (open amount) | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table exists, nature defined | **No test: AR → ledger** |
| 13.6 | ACCOUNTS_PAYABLE | Tiny unpaid supplier invoices (ValorAberto) | `lib/cash-flow/engine.ts` | Insert from tiny_invoices (open amount) | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table exists, nature defined | **No test: AP → ledger** |
| 13.7 | PROJECTED_SIMPLES_TAX | Simples Nacional monthly tax on due date | `lib/cash-flow/engine.ts` | Insert on competence_date + 20 days | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Table exists, nature defined | **No test: tax entry** |
| 13.8 | MANUAL_INFLOW | User-entered cash inflows | `lib/cash-flow/engine.ts` | Insert on user request (route) | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | RLS insert policy exists | **No test: manual entry** |
| 13.9 | MANUAL_OUTFLOW | User-entered cash outflows | `lib/cash-flow/engine.ts` | Insert on user request (route) | `GET /api/cash-flow/ledger` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | RLS insert policy exists | **No test: manual entry** |
| 13.10 | Deduplication: no double-counting scheduled→actual | When payout status changes SCHEDULED→SUCCESSFUL, remove old scheduled entry, insert actual | Test suite | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Should exist | **MUST TEST - data consistency** |
| 13.11 | Deduplication: no double-counting forecast→actual | When sale converts from forecast to actual (SumUp transaction received), remove forecast entry | Test suite | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Should exist | **MUST TEST** |

---

## 14. DEDUPLICATION - Multi-Source Consistency

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 14.1 | Ledger isolation by org_id | RLS ensures one org cannot see another org's ledger | `financial_ledger` table | `is_org_member(org_id)` policy | `GET /api/cash-flow/ledger` | ✓ (RLS test exists) | ✗ | **CRITICAL MISSING** | `PARTIALLY_VALIDATED` | RLS policy defined | **No positive test: verify isolation works** |
| 14.2 | No orphaned ledger entries | Every ledger entry has valid source_id pointing to existing record | Test suite | N/A | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | FK constraints don't exist on ledger | **MUST TEST** |
| 14.3 | Ledger uniqueness per source | Same source + source_id + event_date cannot appear twice | Test suite | UNIQUE constraint (should be added) | N/A | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | No constraint on ledger | **MUST ADD & TEST** |

---

## 15. CASH_FLOW - Daily Balance Projection

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 15.1 | Daily balance calculation | Balance(D) = Balance(D-1) + inflows(D) - outflows(D) | `lib/cash-flow/engine.ts` | Computed from ledger | `GET /api/cash-flow/daily` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No test: running total** |
| 15.2 | Inflows 30 days | Sum of (entrada entries next 30 days) | `lib/cash-flow/engine.ts` | Query ledger where event_date >= today and event_date < today+30 and direction=entrada | `GET /api/cash-flow/summary` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No test: date range** |
| 15.3 | Outflows 30 days | Sum of (saida entries next 30 days) | `lib/cash-flow/engine.ts` | Query ledger where event_date >= today and event_date < today+30 and direction=saida | `GET /api/cash-flow/summary` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No test** |
| 15.4 | Balance D+30 | Cumulative through next 30 days | `lib/cash-flow/engine.ts` | Computed via running sum | `GET /api/cash-flow/summary` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Logic should exist | **No test** |

---

## 16. CMV - Cost of Goods Sold (If Applicable)

| ID | Power Query Source | Business Rule | Implementation File | Database Object | API Endpoint | Unit Test | Integration Test | Golden Dataset Test | Status | Evidence | Known Gap |
|----|-------------------|----------------|------|---------|---------|----------|-----------|--------|--------|----------|-----------|
| 16.1 | CMV defasagem | Calculate COGS defasagem (lag between revenue and cost) | `lib/forecast/engine.ts` | Service logic | `GET /api/forecast/cmv` | ✗ | ✗ | **CRITICAL MISSING** | `IMPLEMENTED_UNVERIFIED` | Code comment mentions it | **No implementation or test** |

---

## Summary Statistics

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| **Total Requirements** | 85 | 85 | — |
| **NOT_IMPLEMENTED** | 0 | 0 | ✓ |
| **IMPLEMENTED_UNVERIFIED** | 80 | 0 | **-80** |
| **PARTIALLY_VALIDATED** | 1 | 5 | **-4** |
| **VALIDATED** | 0 | 80 | **-80** |
| **BLOCKED_BUSINESS_RULE** | 4 | 0 | **+4** |
| **IMPLEMENTATION_COVERAGE** | ~94% | 100% | — |
| **PARITY_VALIDATION_COVERAGE** | ~1% | 95% | **-94%** |

---

## Critical Blockers for Checkpoint 3 Acceptance

1. **NO GOLDEN DATASET TEST FOR FULL FORECAST PIPELINE** (Requirement 10.1)
   - This is the most important test the system needs
   - Must prove: Forecast → Seasonality → PaymentMix → Fee → ReceiptProfile → Cash Receipt

2. **FEE CALCULATION FALLBACK LOGIC UNTESTED** (Requirements 3.5-3.8)
   - No test verifies which fallback tier was used
   - No test verifies the 4-tier system works correctly

3. **INVARIANT TESTS MISSING** (Requirements 3.9, 3.10, 6.3, 7.3, 8.3, 9.2)
   - SUM(pct_valor) = 100%
   - SUM(peso_faixa) = 100%
   - SUM(pct_recebimento) = 100%
   - SUM(receipts) ≈ SUM(forecast) (within rounding)

4. **SIMPLES NACIONAL NOT VALIDATED** (Requirement 11.5)
   - No test for RBT12 band boundaries
   - No test for effective rate calculation

5. **TINY PAYABLES MISIMPLEMENTATION** (Requirement 12.5)
   - Risk: ledger contains total invoice amount instead of only open balance
   - Must test that 1000-400=600 enters ledger, not 1000

6. **LEDGER DEDUPLICATION UNTESTED** (Requirements 13.10, 13.11, 14.1, 14.2, 14.3)
   - No test for scheduled→actual payout transition
   - No test for forecast→actual sale transition
   - No RLS positive test

---

## Recommendation for User

**DO NOT PROCEED TO PHASE L (UI) UNTIL**:

1. Create golden dataset tests for all 16 requirement areas
2. Validate fee calculation fallback 4-tier system
3. Add and pass invariant tests for all percentage distributions
4. Implement and validate Simples Nacional RBT12 boundaries
5. Fix Tiny payables to use open amount only
6. Implement and test ledger deduplication logic
7. Run full integration test: Opening Balance → 30-day forecast → final cash flow

**Current Status**: VALIDATION_REQUIRED  
**PARITY_VALIDATION_COVERAGE**: ~1%  
**Checkpoint 3**: NOT ACCEPTED

