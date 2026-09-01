import { describe, it, expect } from 'vitest'
import { calculateReceiptProfile, projectPaymentReceipt } from '@/lib/forecast/receipt_profile'
import { createMockSupabaseClient } from '../../mocks/supabase'

/**
 * Golden Dataset 05: Receipt Profile - REAL FUNCTION EXECUTION
 * MANDATORY: Tests MUST call calculateReceiptProfile() with actual mocked transactions/payouts
 */

describe('Receipt Profile - GD05', () => {
  it('M+0 single receipt - calls real function', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_transactions: [
        {
          id: 'tx1',
          org_id: 'org1',
          type: 'PAYMENT',
          status: 'SUCCESSFUL',
          transaction_code: 'CODE001',
          timestamp_utc: '2026-01-15T10:00:00Z',
          created_at: '2026-01-15T10:00:00Z',
          payment_type: 'PIX',
          card_type: 'NAO_INFORMADO',
          installments_count: 1,
          entry_mode: 'NAO_INFORMADO',
          payout_plan: 'NAO_INFORMADO',
          amount: 500,
        },
      ],
      sumup_payouts: [
        {
          org_id: 'org1',
          transaction_code: 'CODE001',
          amount: 500,
          date: '2026-01-15',
          status: 'SUCCESSFUL',
          type: 'PAYOUT',
        },
      ],
    })

    const result = await calculateReceiptProfile(mockAdmin, 'org1', 'PIX', 'NAO_INFORMADO', 1, 'NAO_INFORMADO', 'NAO_INFORMADO')

    expect(result.distributions).toHaveLength(1)
    expect(result.distributions[0].meses_ate_receber).toBe(0)
    expect(result.distributions[0].pct_recebimento_modalidade).toBeCloseTo(1.0, 4)
  })

  it('M+1 receipt - one month delay', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_transactions: [
        {
          id: 'tx2',
          org_id: 'org1',
          type: 'PAYMENT',
          status: 'SUCCESSFUL',
          transaction_code: 'CODE002',
          timestamp_utc: '2026-01-10T10:00:00Z',
          created_at: '2026-01-10T10:00:00Z',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          installments_count: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          amount: 300,
        },
      ],
      sumup_payouts: [
        {
          org_id: 'org1',
          transaction_code: 'CODE002',
          amount: 300,
          date: '2026-02-10',
          status: 'SUCCESSFUL',
          type: 'PAYOUT',
        },
      ],
    })

    const result = await calculateReceiptProfile(mockAdmin, 'org1', 'CARD', 'CREDIT', 1, 'POS', 'D+1')

    expect(result.distributions).toHaveLength(1)
    expect(result.distributions[0].meses_ate_receber).toBe(1)
  })

  it('M+0,M+1,M+2 distribution - 3 installments', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_transactions: [
        {
          id: 'tx3',
          org_id: 'org1',
          type: 'PAYMENT',
          status: 'SUCCESSFUL',
          transaction_code: 'CODE003',
          timestamp_utc: '2026-01-05T10:00:00Z',
          created_at: '2026-01-05T10:00:00Z',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          installments_count: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          amount: 600,
        },
      ],
      sumup_payouts: [
        {
          org_id: 'org1',
          transaction_code: 'CODE003',
          amount: 200,
          date: '2026-01-10',
          status: 'SUCCESSFUL',
          type: 'PAYOUT',
        },
        {
          org_id: 'org1',
          transaction_code: 'CODE003',
          amount: 200,
          date: '2026-02-10',
          status: 'SUCCESSFUL',
          type: 'PAYOUT',
        },
        {
          org_id: 'org1',
          transaction_code: 'CODE003',
          amount: 200,
          date: '2026-03-10',
          status: 'SUCCESSFUL',
          type: 'PAYOUT',
        },
      ],
    })

    const result = await calculateReceiptProfile(mockAdmin, 'org1', 'CARD', 'CREDIT', 3, 'POS', 'D+1')

    expect(result.distributions).toHaveLength(3)
    expect(result.distributions[0].meses_ate_receber).toBe(0)
    expect(result.distributions[1].meses_ate_receber).toBe(1)
    expect(result.distributions[2].meses_ate_receber).toBe(2)
  })

  it('December to January rollover', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_transactions: [
        {
          id: 'tx4',
          org_id: 'org1',
          type: 'PAYMENT',
          status: 'SUCCESSFUL',
          transaction_code: 'CODE004',
          timestamp_utc: '2026-12-20T10:00:00Z',
          created_at: '2026-12-20T10:00:00Z',
          payment_type: 'CARD',
          card_type: 'CREDIT',
          installments_count: 1,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          amount: 400,
        },
      ],
      sumup_payouts: [
        {
          org_id: 'org1',
          transaction_code: 'CODE004',
          amount: 400,
          date: '2027-01-20',
          status: 'SUCCESSFUL',
          type: 'PAYOUT',
        },
      ],
    })

    const result = await calculateReceiptProfile(mockAdmin, 'org1', 'CARD', 'CREDIT', 1, 'POS', 'D+1')

    expect(result.distributions[0].meses_ate_receber).toBe(1)
  })

  it('Invariant: SUM(pct) ≈ 1.0 with residual allocation', async () => {
    const mockAdmin = createMockSupabaseClient({
      sumup_transactions: [
        {
          id: 'tx5',
          org_id: 'org1',
          type: 'PAYMENT',
          status: 'SUCCESSFUL',
          transaction_code: 'CODE005',
          timestamp_utc: '2026-01-01T10:00:00Z',
          created_at: '2026-01-01T10:00:00Z',
          payment_type: 'PIX',
          card_type: 'NAO_INFORMADO',
          installments_count: 1,
          entry_mode: 'NAO_INFORMADO',
          payout_plan: 'NAO_INFORMADO',
          amount: 1000,
        },
      ],
      sumup_payouts: [
        {
          org_id: 'org1',
          transaction_code: 'CODE005',
          amount: 333,
          date: '2026-01-15',
          status: 'SUCCESSFUL',
          type: 'PAYOUT',
        },
        {
          org_id: 'org1',
          transaction_code: 'CODE005',
          amount: 333,
          date: '2026-02-15',
          status: 'SUCCESSFUL',
          type: 'PAYOUT',
        },
        {
          org_id: 'org1',
          transaction_code: 'CODE005',
          amount: 334,
          date: '2026-03-15',
          status: 'SUCCESSFUL',
          type: 'PAYOUT',
        },
      ],
    })

    const result = await calculateReceiptProfile(mockAdmin, 'org1', 'PIX', 'NAO_INFORMADO', 1, 'NAO_INFORMADO', 'NAO_INFORMADO')

    const sumPct = result.distributions.reduce((s, d) => s + d.pct_recebimento_modalidade, 0)
    expect(sumPct).toBeCloseTo(1.0, 4)
  })

  it('projectPaymentReceipt transforms profile + amount into month-indexed receipts', () => {
    const profile = {
      payment_type: 'CARD',
      card_type: 'CREDIT',
      nro_parcelas: 3,
      entry_mode: 'POS',
      payout_plan: 'D+1',
      distributions: [
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 0,
          valor_recebido: 300,
          qtd_recebimentos: 10,
          pct_recebimento_modalidade: 0.3,
        },
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 1,
          valor_recebido: 500,
          qtd_recebimentos: 17,
          pct_recebimento_modalidade: 0.5,
        },
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 2,
          valor_recebido: 200,
          qtd_recebimentos: 7,
          pct_recebimento_modalidade: 0.2,
        },
      ],
      confiabilidade: 'ALTA' as const,
      total_payouts_analyzed: 34,
    }

    const receipts = projectPaymentReceipt(1000, '2026-01', profile)

    expect(receipts).toHaveLength(3)
    expect(receipts[0].month).toBe(1)
    expect(receipts[1].month).toBe(2)
    expect(receipts[2].month).toBe(3)
  })

  it('November + M+2 = January year-forward', () => {
    const profile = {
      payment_type: 'CARD',
      card_type: 'CREDIT',
      nro_parcelas: 3,
      entry_mode: 'POS',
      payout_plan: 'D+1',
      distributions: [
        {
          payment_type: 'CARD',
          card_type: 'CREDIT',
          nro_parcelas: 3,
          entry_mode: 'POS',
          payout_plan: 'D+1',
          meses_ate_receber: 2,
          valor_recebido: 1000,
          qtd_recebimentos: 1,
          pct_recebimento_modalidade: 1.0,
        },
      ],
      confiabilidade: 'BAIXA' as const,
      total_payouts_analyzed: 5,
    }

    const receipts = projectPaymentReceipt(1000, '2026-11', profile)

    expect(receipts[0].year).toBe(2027)
    expect(receipts[0].month).toBe(1)
  })
})
