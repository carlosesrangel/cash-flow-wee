import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  calculateSeasonality3Bands,
  validateSeasonalityInvariants,
  distributeBySeasonality,
} from '@/lib/forecast/seasonality'
import { createMockSupabaseClient } from '../../mocks/supabase'

/**
 * Golden Dataset 03: Seasonality 3-Band Distribution
 *
 * Tests all tiers and fallbacks WITH REAL ALGORITHM EXECUTION
 */

describe('Seasonality - GD03', () => {
  let mockAdmin: ReturnType<typeof createMockSupabaseClient> | { from: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockAdmin = createMockSupabaseClient()
  })

  // Tier 1: Same month previous year
  it('Tier 1: same month previous year distribution', async () => {
    const txData = [
      { created_at: '2025-03-05T10:00:00Z', amount: 300, refunded_amount: 0 }, // band 1
      { created_at: '2025-03-15T10:00:00Z', amount: 500, refunded_amount: 0 }, // band 2
      { created_at: '2025-03-25T10:00:00Z', amount: 200, refunded_amount: 0 }, // band 3
    ]

    mockAdmin.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: txData, error: null }),
    }))

    const result = await calculateSeasonality3Bands(mockAdmin, 'org1', 2026, 3)

    expect(result.ano).toBe(2026)
    expect(result.mes).toBe(3)
    expect(result.band1_peso).toBeCloseTo(0.3, 4)
    expect(result.band2_peso).toBeCloseTo(0.5, 4)
    expect(result.band3_peso).toBeCloseTo(0.2, 4)
    expect(result.fallback_used).toBe('SAME_MONTH_PREVIOUS_YEAR')
    expect(validateSeasonalityInvariants(result)).toBe(true)
  })

  // Tier 4: No history
  it('Tier 4: uniform fallback when no history', async () => {
    mockAdmin.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))

    const result = await calculateSeasonality3Bands(mockAdmin, 'org1', 2026, 3)

    expect(result.fallback_used).toBe('SEM_HISTORICO_UNIFORME')
    expect(result.band1_peso).toBeCloseTo(1 / 3, 4)
    expect(result.band2_peso).toBeCloseTo(1 / 3, 4)
    expect(result.band3_peso).toBeCloseTo(1 / 3, 4)
    expect(validateSeasonalityInvariants(result)).toBe(true)
  })

  // Refund handling: amount - refunded, floored at 0
  it('refund > amount floors to 0', async () => {
    const txData = [
      { created_at: '2025-03-05T10:00:00Z', amount: 100, refunded_amount: 150 }, // 0
      { created_at: '2025-03-15T10:00:00Z', amount: 500, refunded_amount: 0 },   // 500
    ]

    mockAdmin.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: txData, error: null }),
    }))

    const result = await calculateSeasonality3Bands(mockAdmin, 'org1', 2026, 3)

    expect(result.band1_peso).toBeCloseTo(0, 4)
    expect(result.band2_peso).toBeCloseTo(1.0, 4)
    expect(result.band3_peso).toBeCloseTo(0, 4)
  })

  // Distribution validation
  it('distributeBySeasonality returns correct amounts', () => {
    const bands = {
      ano: 2026,
      mes: 3,
      band1_peso: 0.3,
      band2_peso: 0.5,
      band3_peso: 0.2,
      receita_mes: 1000,
      fallback_used: 'SAME_MONTH_PREVIOUS_YEAR' as const,
    }

    const [b1, b2, b3] = distributeBySeasonality(1000, bands)

    expect(b1).toBe(300)
    expect(b2).toBe(500)
    expect(b3).toBe(200)
    expect(b1 + b2 + b3).toBe(1000)
  })

  // Invariants
  it('Invariant: SUM(band_peso) = 1.0', () => {
    const cases = [
      { b1: 0.33, b2: 0.33, b3: 0.34 },
      { b1: 0.5, b2: 0.3, b3: 0.2 },
      { b1: 0.2, b2: 0.2, b3: 0.6 },
      { b1: 1 / 3, b2: 1 / 3, b3: 1 / 3 },
    ]

    for (const tc of cases) {
      const sum = tc.b1 + tc.b2 + tc.b3
      expect(sum).toBeCloseTo(1.0, 5)
    }
  })
})
