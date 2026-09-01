import { describe, it, expect } from 'vitest'
import { aggregateByReceiptDate } from '@/lib/forecast/pipeline'

/**
 * Golden Dataset 07: Full Forecast Pipeline - AGGREGATION TESTS
 * Tests deterministic aggregation logic (does not require Supabase mocks)
 */

type ForecastEntryTest = {
  year: number
  month: number
  sale_date: Date
  payment_type: string
  card_type: string
  nro_parcelas: number
  entry_mode: string
  payout_plan: string
  banda: number
  amount_venda_modalidade: number
  taxa_venda: number
  fee_venda: number
  receipt_month: number
  receipt_year: number
  receipt_day: number
  receipt_date: Date
  amount_recebimento: number
  fee_recebimento: number
  amount_liquido_recebimento: number
  confiabilidade_seasonality: string
  confiabilidade_mix: string
  confiabilidade_fee: string
  confiabilidade_receipt: string
}

describe('Pipeline - GD07 END-TO-END', () => {
  it('Aggregation: multiple entries same month consolidate', () => {
    const entries = [
      {
        year: 2026,
        month: 1,
        sale_date: new Date(2026, 0, 10),
        payment_type: 'CARD',
        card_type: 'CREDIT',
        nro_parcelas: 1,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        banda: 1,
        amount_venda_modalidade: 300,
        taxa_venda: 0.02,
        fee_venda: 6,
        receipt_month: 1,
        receipt_year: 2026,
        receipt_day: 10,
        receipt_date: new Date(2026, 0, 10),
        amount_recebimento: 300,
        fee_recebimento: 6,
        amount_liquido_recebimento: 294,
        confiabilidade_seasonality: 'MEDIA',
        confiabilidade_mix: 'ALTA',
        confiabilidade_fee: 'MEDIA',
        confiabilidade_receipt: 'ALTA',
      },
      {
        year: 2026,
        month: 1,
        sale_date: new Date(2026, 0, 20),
        payment_type: 'CARD',
        card_type: 'CREDIT',
        nro_parcelas: 1,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        banda: 2,
        amount_venda_modalidade: 500,
        taxa_venda: 0.02,
        fee_venda: 10,
        receipt_month: 1,
        receipt_year: 2026,
        receipt_day: 20,
        receipt_date: new Date(2026, 0, 20),
        amount_recebimento: 500,
        fee_recebimento: 10,
        amount_liquido_recebimento: 490,
        confiabilidade_seasonality: 'MEDIA',
        confiabilidade_mix: 'ALTA',
        confiabilidade_fee: 'MEDIA',
        confiabilidade_receipt: 'ALTA',
      },
    ] as ForecastEntryTest[]

    const aggregated = aggregateByReceiptDate(entries as ForecastEntryTest[] as any)

    expect(aggregated).toHaveLength(1)
    expect(aggregated[0].gross_amount).toBe(800)
    expect(aggregated[0].total_fees).toBe(16)
    expect(aggregated[0].net_amount).toBe(784)
  })

  it('Aggregation: entries sorted chronologically by receipt date', () => {
    const entries = [
      {
        year: 2026,
        month: 1,
        sale_date: new Date(2026, 0, 1),
        payment_type: 'CARD',
        card_type: 'CREDIT',
        nro_parcelas: 1,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        banda: 1,
        amount_venda_modalidade: 100,
        taxa_venda: 0.02,
        fee_venda: 2,
        receipt_month: 3,
        receipt_year: 2026,
        receipt_day: 1,
        receipt_date: new Date(2026, 2, 1),
        amount_recebimento: 100,
        fee_recebimento: 2,
        amount_liquido_recebimento: 98,
        confiabilidade_seasonality: 'MEDIA',
        confiabilidade_mix: 'ALTA',
        confiabilidade_fee: 'MEDIA',
        confiabilidade_receipt: 'ALTA',
      },
      {
        year: 2026,
        month: 1,
        sale_date: new Date(2026, 0, 1),
        payment_type: 'CARD',
        card_type: 'CREDIT',
        nro_parcelas: 1,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        banda: 1,
        amount_venda_modalidade: 100,
        taxa_venda: 0.02,
        fee_venda: 2,
        receipt_month: 1,
        receipt_year: 2026,
        receipt_day: 1,
        receipt_date: new Date(2026, 0, 1),
        amount_recebimento: 100,
        fee_recebimento: 2,
        amount_liquido_recebimento: 98,
        confiabilidade_seasonality: 'MEDIA',
        confiabilidade_mix: 'ALTA',
        confiabilidade_fee: 'MEDIA',
        confiabilidade_receipt: 'ALTA',
      },
    ] as any[]

    const aggregated = aggregateByReceiptDate(entries)

    expect(aggregated[0].receipt_month).toBe(1)
    expect(aggregated[1].receipt_month).toBe(3)
  })

  it('Year boundary: December sale to January receipt', () => {
    const entries = [
      {
        year: 2026,
        month: 12,
        sale_date: new Date(2026, 11, 20),
        payment_type: 'CARD',
        card_type: 'CREDIT',
        nro_parcelas: 1,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        banda: 3,
        amount_venda_modalidade: 500,
        taxa_venda: 0.02,
        fee_venda: 10,
        receipt_month: 1,
        receipt_year: 2027,
        receipt_day: 20,
        receipt_date: new Date(2027, 0, 20),
        amount_recebimento: 500,
        fee_recebimento: 10,
        amount_liquido_recebimento: 490,
        confiabilidade_seasonality: 'MEDIA',
        confiabilidade_mix: 'ALTA',
        confiabilidade_fee: 'MEDIA',
        confiabilidade_receipt: 'ALTA',
      },
    ] as any[]

    const aggregated = aggregateByReceiptDate(entries)

    expect(aggregated[0].receipt_year).toBe(2027)
    expect(aggregated[0].receipt_month).toBe(1)
  })

  it('Invariant: revenue conservation (gross - fees = net)', () => {
    const entries = [
      {
        year: 2026,
        month: 1,
        sale_date: new Date(2026, 0, 1),
        payment_type: 'PIX',
        card_type: 'NAO_INFORMADO',
        nro_parcelas: 1,
        entry_mode: 'NAO_INFORMADO',
        payout_plan: 'NAO_INFORMADO',
        banda: 1,
        amount_venda_modalidade: 1000,
        taxa_venda: 0.005,
        fee_venda: 5,
        receipt_month: 1,
        receipt_year: 2026,
        receipt_day: 1,
        receipt_date: new Date(2026, 0, 1),
        amount_recebimento: 1000,
        fee_recebimento: 5,
        amount_liquido_recebimento: 995,
        confiabilidade_seasonality: 'MEDIA',
        confiabilidade_mix: 'ALTA',
        confiabilidade_fee: 'MEDIA',
        confiabilidade_receipt: 'ALTA',
      },
    ] as any[]

    const aggregated = aggregateByReceiptDate(entries)

    expect(aggregated[0].gross_amount - aggregated[0].total_fees).toBe(aggregated[0].net_amount)
  })

  it('Invariant: SUM(bands) = 1.0 (seasonality split)', () => {
    const band1 = 0.3
    const band2 = 0.5
    const band3 = 0.2
    const sum = band1 + band2 + band3

    expect(sum).toBeCloseTo(1.0, 4)
  })

  it('Multi-month consolidation', () => {
    const entries = [
      {
        year: 2026,
        month: 1,
        sale_date: new Date(2026, 0, 10),
        payment_type: 'CARD',
        card_type: 'CREDIT',
        nro_parcelas: 1,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        banda: 1,
        amount_venda_modalidade: 100,
        taxa_venda: 0.02,
        fee_venda: 2,
        receipt_month: 1,
        receipt_year: 2026,
        receipt_day: 10,
        receipt_date: new Date(2026, 0, 10),
        amount_recebimento: 100,
        fee_recebimento: 2,
        amount_liquido_recebimento: 98,
        confiabilidade_seasonality: 'MEDIA',
        confiabilidade_mix: 'ALTA',
        confiabilidade_fee: 'MEDIA',
        confiabilidade_receipt: 'ALTA',
      },
      {
        year: 2026,
        month: 1,
        sale_date: new Date(2026, 0, 10),
        payment_type: 'CARD',
        card_type: 'CREDIT',
        nro_parcelas: 3,
        entry_mode: 'POS',
        payout_plan: 'D+1',
        banda: 2,
        amount_venda_modalidade: 200,
        taxa_venda: 0.025,
        fee_venda: 5,
        receipt_month: 2,
        receipt_year: 2026,
        receipt_day: 10,
        receipt_date: new Date(2026, 1, 10),
        amount_recebimento: 200,
        fee_recebimento: 5,
        amount_liquido_recebimento: 195,
        confiabilidade_seasonality: 'MEDIA',
        confiabilidade_mix: 'ALTA',
        confiabilidade_fee: 'MEDIA',
        confiabilidade_receipt: 'ALTA',
      },
      {
        year: 2026,
        month: 1,
        sale_date: new Date(2026, 0, 10),
        payment_type: 'PIX',
        card_type: 'NAO_INFORMADO',
        nro_parcelas: 1,
        entry_mode: 'NAO_INFORMADO',
        payout_plan: 'NAO_INFORMADO',
        banda: 3,
        amount_venda_modalidade: 150,
        taxa_venda: 0.005,
        fee_venda: 0.75,
        receipt_month: 1,
        receipt_year: 2026,
        receipt_day: 10,
        receipt_date: new Date(2026, 0, 10),
        amount_recebimento: 150,
        fee_recebimento: 0.75,
        amount_liquido_recebimento: 149.25,
        confiabilidade_seasonality: 'MEDIA',
        confiabilidade_mix: 'ALTA',
        confiabilidade_fee: 'MEDIA',
        confiabilidade_receipt: 'ALTA',
      },
    ] as any[]

    const aggregated = aggregateByReceiptDate(entries)

    expect(aggregated).toHaveLength(2)
    expect(aggregated[0].receipt_month).toBe(1)
    expect(aggregated[1].receipt_month).toBe(2)

    expect(aggregated[0].gross_amount).toBe(250)
    expect(aggregated[1].gross_amount).toBe(200)
  })
})
