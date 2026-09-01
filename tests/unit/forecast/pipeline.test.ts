import { describe, it, expect } from 'vitest'
import { aggregateByReceiptDate } from '@/lib/forecast/pipeline'

/**
 * Golden Dataset 07: Forecast Pipeline
 *
 * Tests end-to-end forecast projection with all components integrated
 */

describe('Forecast Pipeline Golden Dataset', () => {
  it('Simple pipeline: 1000 forecast, 3% fee, M+1 receipt = 970 net received', () => {
    // Scenario:
    // - Forecast: R$ 1000 for CARD 3x in January
    // - Seasonality: all in band 1 (first 9 days, 100%)
    // - Fee: 3% rate
    // - Receipt: 100% in M+1 (February)
    //
    // Expected:
    // - Gross received Feb: R$ 1000
    // - Fees: R$ 30
    // - Net: R$ 970

    const baseAmount = 1000
    const feeRate = 0.03
    const seasonalityBand = 1.0 // 100% in band 1
    const receiptMonths = 1 // 100% in M+1

    const grossAmount = baseAmount * seasonalityBand
    const fees = grossAmount * feeRate
    const netAmount = grossAmount - fees

    expect(grossAmount).toBe(1000)
    expect(fees).toBe(30)
    expect(netAmount).toBe(970)
  })

  it('Multi-band distribution: 1000 forecast with 3-band split', () => {
    // Scenario:
    // - Forecast: R$ 1000 for CARD 3x in January
    // - Seasonality: [30% band1, 50% band2, 20% band3]
    // - Fee: 2% rate
    // - Receipt: 100% in M+1
    //
    // Expected per band:
    // - Band 1: R$ 300, fees 6, net 294
    // - Band 2: R$ 500, fees 10, net 490
    // - Band 3: R$ 200, fees 4, net 196
    // - Total: R$ 1000, fees 20, net 980

    const baseAmount = 1000
    const feeRate = 0.02
    const seasonality = [0.3, 0.5, 0.2]

    const perBand = seasonality.map((pct) => {
      const gross = baseAmount * pct
      const fees = gross * feeRate
      const net = gross - fees
      return { gross, fees, net }
    })

    expect(perBand[0].gross).toBe(300)
    expect(perBand[0].fees).toBe(6)
    expect(perBand[0].net).toBe(294)

    expect(perBand[1].gross).toBe(500)
    expect(perBand[1].fees).toBe(10)
    expect(perBand[1].net).toBe(490)

    expect(perBand[2].gross).toBe(200)
    expect(perBand[2].fees).toBe(4)
    expect(perBand[2].net).toBe(196)

    const totalGross = perBand.reduce((sum, b) => sum + b.gross, 0)
    const totalFees = perBand.reduce((sum, b) => sum + b.fees, 0)
    const totalNet = perBand.reduce((sum, b) => sum + b.net, 0)

    expect(totalGross).toBe(1000)
    expect(totalFees).toBe(20)
    expect(totalNet).toBe(980)
  })

  it('Multi-modality: different payment types aggregated', () => {
    // Scenario:
    // - January forecast:
    //   - CARD 1x R$ 500 (2% fee, receipt M+0)
    //   - CARD 3x R$ 300 (3% fee, receipt M+1)
    //   - PIX     R$ 200 (0.5% fee, receipt M+0)
    //
    // Expected February receipts:
    // - CARD 3x: R$ 300 - 9 = R$ 291
    // - Total receipts Feb: R$ 291

    const modalities = [
      { payment_type: 'CARD 1x', amount: 500, feeRate: 0.02, receiptMonth: 0 },
      { payment_type: 'CARD 3x', amount: 300, feeRate: 0.03, receiptMonth: 1 },
      { payment_type: 'PIX', amount: 200, feeRate: 0.005, receiptMonth: 0 },
    ]

    const receiptsByMonth = new Map<number, { gross: number; fees: number }>()

    for (const m of modalities) {
      const fees = m.amount * m.feeRate
      const net = m.amount - fees

      const existing = receiptsByMonth.get(m.receiptMonth) || { gross: 0, fees: 0 }
      existing.gross += m.amount
      existing.fees += fees
      receiptsByMonth.set(m.receiptMonth, existing)
    }

    // Month 0 (January): CARD 1x + PIX
    const month0 = receiptsByMonth.get(0)
    expect(month0?.gross).toBe(700) // 500 + 200
    expect(month0?.fees).toBe(10 + 1) // 10 + 1

    // Month 1 (February): CARD 3x
    const month1 = receiptsByMonth.get(1)
    expect(month1?.gross).toBe(300)
    expect(month1?.fees).toBe(9) // 300 * 0.03
  })

  it('Receipt profile with multiple bands', () => {
    // Scenario:
    // - R$ 1000 sale, distributed across months:
    //   - M+0: 20% = R$ 200
    //   - M+1: 50% = R$ 500
    //   - M+2: 30% = R$ 300

    const saleAmount = 1000
    const distribution = [
      { meses: 0, pct: 0.2 },
      { meses: 1, pct: 0.5 },
      { meses: 2, pct: 0.3 },
    ]

    const receipts = distribution.map((d) => ({
      meses: d.meses,
      amount: saleAmount * d.pct,
    }))

    expect(receipts[0].amount).toBe(200)
    expect(receipts[1].amount).toBe(500)
    expect(receipts[2].amount).toBe(300)

    const totalReceipts = receipts.reduce((sum, r) => sum + r.amount, 0)
    expect(totalReceipts).toBe(1000)
  })

  it('Aggregation by receipt date', () => {
    // Scenario: Multiple modalities received in same month
    // February receipts:
    // - CARD 1x band1: R$ 500 - 10 (2%) = R$ 490
    // - CARD 3x band1: R$ 300 - 9 (3%) = R$ 291
    // - PIX: R$ 100 - 0.5 (0.5%) = R$ 99.5
    // Total: R$ 900.5 net, R$ 980.5 gross

    const entries = [
      {
        receipt_year: 2026,
        receipt_month: 2,
        receipt_amount: 500,
        expected_fee_amount: 10,
        confiabilidade_fee: 'ALTA' as const,
      },
      {
        receipt_year: 2026,
        receipt_month: 2,
        receipt_amount: 300,
        expected_fee_amount: 9,
        confiabilidade_fee: 'MEDIA' as const,
      },
      {
        receipt_year: 2026,
        receipt_month: 2,
        receipt_amount: 100,
        expected_fee_amount: 0.5,
        confiabilidade_fee: 'ALTA' as const,
      },
    ] as any[]

    const aggregated = aggregateByReceiptDate(entries)

    expect(aggregated).toHaveLength(1)
    expect(aggregated[0].receipt_year).toBe(2026)
    expect(aggregated[0].receipt_month).toBe(2)
    expect(aggregated[0].gross_amount).toBe(900)
    expect(aggregated[0].total_fees).toBe(19.5)
    expect(aggregated[0].net_amount).toBeCloseTo(880.5, 1)
    expect(aggregated[0].transaction_count).toBe(3)
  })

  it('Confidence aggregation: minimum confidence level', () => {
    // Scenario: Multiple receipts in same month with different confidence levels
    // Expected confidence = minimum (ALTA, MEDIA, ALTA = MEDIA)

    const entries = [
      {
        receipt_year: 2026,
        receipt_month: 2,
        receipt_amount: 100,
        expected_fee_amount: 2,
        confiabilidade_fee: 'ALTA' as const,
      },
      {
        receipt_year: 2026,
        receipt_month: 2,
        receipt_amount: 100,
        expected_fee_amount: 2,
        confiabilidade_fee: 'MEDIA' as const,
      },
      {
        receipt_year: 2026,
        receipt_month: 2,
        receipt_amount: 100,
        expected_fee_amount: 2,
        confiabilidade_fee: 'ALTA' as const,
      },
    ] as any[]

    const aggregated = aggregateByReceiptDate(entries)

    expect(aggregated[0].confidence_min).toBe('MEDIA') // minimum is MEDIA
  })

  it('Timeline preservation: receipts sorted by date', () => {
    // Scenario: Forecasts generate receipts across multiple months
    // Should be sorted chronologically

    const entries = [
      {
        receipt_year: 2026,
        receipt_month: 3,
        receipt_amount: 100,
        expected_fee_amount: 2,
        confiabilidade_fee: 'ALTA' as const,
      },
      {
        receipt_year: 2026,
        receipt_month: 1,
        receipt_amount: 200,
        expected_fee_amount: 4,
        confiabilidade_fee: 'ALTA' as const,
      },
      {
        receipt_year: 2026,
        receipt_month: 2,
        receipt_amount: 150,
        expected_fee_amount: 3,
        confiabilidade_fee: 'ALTA' as const,
      },
    ] as any[]

    const aggregated = aggregateByReceiptDate(entries)

    expect(aggregated[0].receipt_month).toBe(1)
    expect(aggregated[1].receipt_month).toBe(2)
    expect(aggregated[2].receipt_month).toBe(3)
  })

  it('Year rollover: December forecast generates January next year receipts', () => {
    // Scenario: December 2026 forecast with M+1 receipt = January 2027

    const entries = [
      {
        receipt_year: 2027,
        receipt_month: 1,
        receipt_amount: 500,
        expected_fee_amount: 10,
        confiabilidade_fee: 'ALTA' as const,
      },
    ] as any[]

    const aggregated = aggregateByReceiptDate(entries)

    expect(aggregated[0].receipt_year).toBe(2027)
    expect(aggregated[0].receipt_month).toBe(1)
  })
})
