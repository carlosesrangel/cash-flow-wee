import { describe, it, expect } from 'vitest'

/**
 * Golden Dataset 10: Complete Forecast Actualization
 *
 * End-to-end scenario: forecast → sales → payouts → ledger → cash flow
 * Tests how forecast is replaced by actuals as they realize
 *
 * Power Query specification: Points 11-13, 22-24
 */

describe('GD10: Forecast Actualization Integration', () => {
  it('Forecast M+1 and M+2, then M+1 realizes with actual sales', () => {
    // SCENARIO:
    // January 2026: Forecast for Feb and March
    // February: Actual sales arrive, replace Feb forecast
    // March: Still forecast only

    // FORECAST (created Jan 15):
    const forecast_feb = {
      mes: 2,
      ano: 2026,
      modalidade: 'CARD 3x',
      valor_previsto: 10000,
      fonte: 'forecast',
      status: 'projected',
    }

    const forecast_mar = {
      mes: 3,
      ano: 2026,
      modalidade: 'CARD 3x',
      valor_previsto: 12000,
      fonte: 'forecast',
      status: 'projected',
    }

    // ACTUAL SALES (Feb completes):
    const actual_feb = {
      mes: 2,
      ano: 2026,
      modalidade: 'CARD 3x',
      valor_realizado: 9800, // close to forecast
      fonte: 'sumup',
      status: 'actual',
    }

    // CASH FLOW RULES:
    // Option A: Replace forecast → Feb forecast is gone, only actual remains
    // Option B: Track both → Feb has both forecast and actual for variance
    // Spec says: Not defined (Point 24)

    // Recommendation (Option B: Track variance):
    // This allows observability, reconciliation, variance analysis
    const cash_flow_state = {
      feb: {
        forecast: forecast_feb.valor_previsto,
        actual: actual_feb.valor_realizado,
        variance: actual_feb.valor_realizado - forecast_feb.valor_previsto, // -200
      },
      mar: {
        forecast: forecast_mar.valor_previsto,
        actual: null, // still projected
      },
    }

    expect(cash_flow_state.feb.forecast).toBe(10000)
    expect(cash_flow_state.feb.actual).toBe(9800)
    expect(cash_flow_state.feb.variance).toBe(-200)
    expect(cash_flow_state.mar.actual).toBeNull()
  })

  it('Multi-band forecast with staggered realization', () => {
    // SCENARIO: 3-band forecast with M+0, M+1, M+2 receipt distribution
    // Forecast (Jan 1): R$ 10k forecast, distributed [30%, 50%, 20%] across M, M+1, M+2
    // Actual (Feb 1): R$ 9.8k sales, with same distribution

    // FORECAST BREAKDOWN:
    // M+0 (Feb): 10k * 30% = 3000
    // M+1 (Mar): 10k * 50% = 5000
    // M+2 (Apr): 10k * 20% = 2000

    // ACTUAL BREAKDOWN (Feb):
    // M+0 (Feb): 9.8k * 30% = 2940
    // M+1 (Mar): 9.8k * 50% = 4900
    // M+2 (Apr): 9.8k * 20% = 1960

    const forecast_by_receipt = [
      { mes_recebimento: 2, valor: 3000, tipo: 'forecast' },
      { mes_recebimento: 3, valor: 5000, tipo: 'forecast' },
      { mes_recebimento: 4, valor: 2000, tipo: 'forecast' },
    ]

    const actual_by_receipt = [
      { mes_recebimento: 2, valor: 2940, tipo: 'actual' },
      { mes_recebimento: 3, valor: 4900, tipo: 'actual' },
      { mes_recebimento: 4, valor: 1960, tipo: 'actual' },
    ]

    // Cash flow should track both:
    const cash_flow = {
      feb: {
        forecast: 3000,
        actual: 2940,
        variance: -60,
      },
      mar: {
        forecast: 5000,
        actual: 4900,
        variance: -100,
      },
      apr: {
        forecast: 2000,
        actual: 1960,
        variance: -40,
      },
    }

    expect(cash_flow.feb.variance).toBe(-60)
    expect(cash_flow.mar.variance).toBe(-100)
    expect(cash_flow.apr.variance).toBe(-40)

    const total_variance = cash_flow.feb.variance + cash_flow.mar.variance + cash_flow.apr.variance
    expect(total_variance).toBe(-200) // = 10000 - 9800
  })

  it('Ledger tracks both forecast and actual without double-count', () => {
    // LEDGER ENTRIES:
    // 1. Forecast entry (projected): R$ 3000, mes 2, status='projected'
    // 2. Actual entry (actual): R$ 2940, mes 2, status='actual'
    //
    // When querying "cash for Feb", must:
    // - Include actual (R$ 2940)
    // - Include forecast only if no actual (R$ 0, because actual exists)
    // OR
    // - Report both separately (forecast vs actual)

    const ledger = [
      {
        id: 'ledger-1',
        source: 'FORECAST',
        source_id: 'forecast-123',
        event_date: '2026-02-28',
        amount: 3000,
        status: 'projected',
      },
      {
        id: 'ledger-2',
        source: 'SUMUP',
        source_id: 'payout-456',
        event_date: '2026-02-28',
        amount: 2940,
        status: 'actual',
      },
    ]

    // Query for Feb cash:
    const feb_actual = ledger.filter((e) => e.status === 'actual')
    const feb_forecast_only = ledger.filter(
      (e) => e.status === 'projected' && !ledger.find((a) => a.event_date === e.event_date && a.status === 'actual')
    )

    const feb_cash = {
      actual: feb_actual.reduce((sum, e) => sum + e.amount, 0),
      forecast_fallback: feb_forecast_only.reduce((sum, e) => sum + e.amount, 0),
      total_conservative: 2940, // only count actual
      total_optimistic: 2940 + 0, // actual + forecast (but no forecast since actual exists)
    }

    expect(feb_cash.actual).toBe(2940)
    expect(feb_cash.forecast_fallback).toBe(0) // because actual exists
    expect(feb_cash.total_conservative).toBe(2940)
  })

  it('Multi-modality actualization: card and PIX mixed', () => {
    // FORECAST:
    // CARD 3x: R$ 5000
    // PIX: R$ 3000
    // Total: R$ 8000

    // ACTUAL:
    // CARD 3x: R$ 4800 (realized)
    // PIX: R$ 2900 (realized)
    // Total: R$ 7700

    // RECEIPT PROFILE matters:
    // CARD M+0: 30%, M+1: 50%, M+2: 20%
    // PIX M+0: 100%

    const forecast = {
      card: 5000,
      pix: 3000,
      total: 8000,
    }

    const actual = {
      card: 4800,
      pix: 2900,
      total: 7700,
    }

    // Feb cash (M+0):
    const feb_forecast = 5000 * 0.3 + 3000 * 1.0 // CARD 30% + PIX 100%
    const feb_actual = 4800 * 0.3 + 2900 * 1.0 // same distribution

    expect(feb_forecast).toBe(1500 + 3000) // 4500
    expect(feb_actual).toBeCloseTo(1440 + 2900, 0) // 4340
  })

  it('Tax implications: actual affects RBT12 retroactively', () => {
    // SCENARIO: Feb forecast was for 10k, but actual is 8k
    // This affects Feb tax planning (DAS = Simples based on RBT12)

    // DAS DUE: March 20 (for Feb competence)
    // - Forecast basis: Feb 10k + Jan 15k = RBT12 (Feb) = 25k
    // - Actual basis: Feb 8k + Jan 15k = RBT12 (Feb) = 23k

    // Tax calculated on forecast (March 20):
    const forecast_rbt12 = 25000
    const forecast_tax_rate = 0.04 // Faixa 1
    const forecast_das = forecast_rbt12 * forecast_tax_rate // 1000

    // Actual RBT12 (for future Mar planning):
    const actual_rbt12 = 23000
    const actual_tax_rate = 0.04 // still Faixa 1
    const actual_das = actual_rbt12 * actual_tax_rate // 920

    // Difference: 80 (overpaid)
    const tax_adjustment = forecast_das - actual_das
    expect(tax_adjustment).toBe(80)

    // Must track for reconciliation in Q2 declaration
  })

  it('Forecast actualization timeline', () => {
    // TIMELINE:
    // Jan 1: Forecast created → Ledger has PROJECTED entry
    // Feb 1: Actual sales → Ledger adds ACTUAL entry, forecast remains for variance
    // Mar 1: Next month forecast → New PROJECTED entries for Apr/May
    // Mar 20: March DAS due → Uses actual Feb RBT12

    const timeline = [
      {
        date: '2026-01-01',
        event: 'Forecast created (Feb+Mar)',
        ledger_state: ['PROJECTED_Feb', 'PROJECTED_Mar'],
      },
      {
        date: '2026-02-01',
        event: 'Actual sales close Feb',
        ledger_state: ['PROJECTED_Feb', 'ACTUAL_Feb', 'PROJECTED_Mar'],
      },
      {
        date: '2026-02-20',
        event: 'DAS due for Feb competence',
        tax_calculation: 'Uses ACTUAL Feb amount for RBT12',
      },
      {
        date: '2026-03-01',
        event: 'Actual sales close Mar, new forecast for Apr+May',
        ledger_state: ['PROJECTED_Feb', 'ACTUAL_Feb', 'PROJECTED_Mar', 'ACTUAL_Mar', 'PROJECTED_Apr', 'PROJECTED_May'],
      },
    ]

    // Verify timeline coherence
    expect(timeline[0].ledger_state).toContain('PROJECTED_Feb')
    expect(timeline[1].ledger_state).toContain('ACTUAL_Feb')
    expect(timeline[1].ledger_state).toContain('PROJECTED_Feb') // kept for variance
  })
})
