import { describe, it, expect } from 'vitest'
import { cashBalanceSnapshotSchema, manualCashEntrySchema } from '@/lib/validation/cash-flow'

describe('cashBalanceSnapshotSchema', () => {
  it('accepts a valid snapshot with optional fields omitted', () => {
    const result = cashBalanceSnapshotSchema.safeParse({ referenceDate: '2026-08-15', bankBalance: 12000 })
    expect(result.success).toBe(true)
  })

  it('rejects a malformed referenceDate', () => {
    const result = cashBalanceSnapshotSchema.safeParse({ referenceDate: '15/08/2026', bankBalance: 12000 })
    expect(result.success).toBe(false)
  })
})

describe('manualCashEntrySchema', () => {
  const base = {
    type: 'entrada' as const,
    description: 'Aporte dos sócios',
    amount: 5000,
    entryDate: '2026-08-15',
    justification: 'Reforço de caixa combinado em reunião',
  }

  it('accepts a valid entrada', () => {
    expect(manualCashEntrySchema.safeParse(base).success).toBe(true)
  })

  it('rejects a non-positive amount for entrada', () => {
    expect(manualCashEntrySchema.safeParse({ ...base, amount: 0 }).success).toBe(false)
    expect(manualCashEntrySchema.safeParse({ ...base, amount: -10 }).success).toBe(false)
  })

  it('accepts a negative amount for ajuste_saldo', () => {
    expect(manualCashEntrySchema.safeParse({ ...base, type: 'ajuste_saldo', amount: -300 }).success).toBe(true)
  })

  it('rejects a zero amount for ajuste_saldo', () => {
    expect(manualCashEntrySchema.safeParse({ ...base, type: 'ajuste_saldo', amount: 0 }).success).toBe(false)
  })

  it('rejects an empty justification', () => {
    expect(manualCashEntrySchema.safeParse({ ...base, justification: '' }).success).toBe(false)
  })
})
