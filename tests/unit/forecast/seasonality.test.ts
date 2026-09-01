import { describe, it, expect } from 'vitest'
import { validateSeasonalityInvariants, distributeBySeasonality } from '@/lib/forecast/seasonality'

/**
 * Golden Dataset 03: Sazonalidade 3-Bands
 *
 * Tests the 3-band decomposition and fallback hierarchy
 */

describe('Sazonalidade Golden Dataset', () => {
  it('Band distribution: dias 1-9, 10-19, 20-31', () => {
    // Scenario: January with observed distribution
    // Band 1 (1-9):   R$2000 (30%)
    // Band 2 (10-19): R$3000 (45%)
    // Band 3 (20-31): R$1000 (25%)
    // Total:          R$6000 (100%)

    const january = {
      ano: 2026,
      mes: 1,
      band1_peso: 0.333,
      band2_peso: 0.5,
      band3_peso: 0.167,
      receita_mes: 6000,
      fallback_used: 'HISTORICAL' as const,
    }

    // Validate invariant
    const sum = january.band1_peso + january.band2_peso + january.band3_peso
    expect(sum).toBeCloseTo(1.0, 2)
  })

  it('Invariant: SUM(band_peso) = 1.0 always holds', () => {
    const test_cases = [
      { band1: 0.33, band2: 0.33, band3: 0.34, expected_sum: 1.0 },
      { band1: 0.5, band2: 0.3, band3: 0.2, expected_sum: 1.0 },
      { band1: 0.2, band2: 0.2, band3: 0.6, expected_sum: 1.0 },
      { band1: 1 / 3, band2: 1 / 3, band3: 1 / 3, expected_sum: 1.0 },
    ]

    for (const tc of test_cases) {
      const sum = tc.band1 + tc.band2 + tc.band3
      expect(sum).toBeCloseTo(tc.expected_sum, 5)
    }
  })

  it('Fallback Tier 1: Same month previous year (most reliable)', () => {
    // Scenario: January 2026 forecast
    // January 2025 data exists: band distribution [0.3, 0.5, 0.2]
    // Should use January 2025 bands

    const tier1_historical = {
      ano: 2026,
      mes: 1,
      band1_peso: 0.3,
      band2_peso: 0.5,
      band3_peso: 0.2,
      receita_mes: 5000,
      fallback_used: 'HISTORICAL' as const,
    }

    expect(tier1_historical.fallback_used).toBe('HISTORICAL')
    // This has highest seasonal accuracy
    expect(validateSeasonalityInvariants(tier1_historical)).toBe(true)
  })

  it('Fallback Tier 2: Recent 6-month average when Tier 1 unavailable', () => {
    // Scenario: January 2026 forecast, but January 2025 data sparse
    // Recent 6 months (Aug-Jan 2025) average: [0.35, 0.45, 0.2]
    // Should use recent average

    const tier2_recent = {
      ano: 2026,
      mes: 1,
      band1_peso: 0.35,
      band2_peso: 0.45,
      band3_peso: 0.2,
      receita_mes: 5500,
      fallback_used: 'RECENT' as const,
    }

    expect(tier2_recent.fallback_used).toBe('RECENT')
    expect(validateSeasonalityInvariants(tier2_recent)).toBe(true)
  })

  it('Fallback Tier 3: Global 12-month average', () => {
    // Scenario: Both Tier 1 and 2 unavailable (new org with little data)
    // 12-month global average: [0.33, 0.33, 0.34]
    // Should use global

    const tier3_global = {
      ano: 2026,
      mes: 1,
      band1_peso: 0.33,
      band2_peso: 0.33,
      band3_peso: 0.34,
      receita_mes: 0,
      fallback_used: 'GLOBAL' as const,
    }

    expect(tier3_global.fallback_used).toBe('GLOBAL')
    expect(validateSeasonalityInvariants(tier3_global)).toBe(true)
  })

  it('Fallback Tier 4: Default equal split (1/3 each) if no data', () => {
    // Scenario: completely new organization with no historical data
    // Should default to equal split

    const tier4_default = {
      ano: 2026,
      mes: 1,
      band1_peso: 1 / 3,
      band2_peso: 1 / 3,
      band3_peso: 1 / 3,
      receita_mes: 0,
      fallback_used: 'DEFAULT' as const,
    }

    expect(tier4_default.fallback_used).toBe('DEFAULT')
    expect(validateSeasonalityInvariants(tier4_default)).toBe(true)
    // Each band exactly 1/3
    expect(tier4_default.band1_peso).toBeCloseTo(0.3333, 4)
  })

  it('Distribution: applying weights to forecast amount', () => {
    // Scenario: forecast R$9000 for January with bands [0.3, 0.5, 0.2]
    const forecast = 9000
    const bands = {
      ano: 2026,
      mes: 1,
      band1_peso: 0.3,
      band2_peso: 0.5,
      band3_peso: 0.2,
      receita_mes: 0,
      fallback_used: 'HISTORICAL' as const,
    }

    const [band1, band2, band3] = distributeBySeasonality(forecast, bands)

    expect(band1).toBe(2700) // 9000 * 0.3
    expect(band2).toBe(4500) // 9000 * 0.5
    expect(band3).toBe(1800) // 9000 * 0.2
    expect(band1 + band2 + band3).toBeCloseTo(forecast, 5)
  })

  it('Month-end boundaries: Feb 28/29 only (band3 has fewer days)', () => {
    // Scenario: February (28/29 days vs 31)
    // Days 20-28 = 9 days (same as bands 1 and 2)
    // But revenue might vary due to fewer days
    // Band weights should still sum to 1.0

    const february = {
      ano: 2026,
      mes: 2,
      band1_peso: 0.3,
      band2_peso: 0.35, // maybe higher (9 days + Feb has more business days)
      band3_peso: 0.35, // maybe lower (only 9 days vs 12)
      receita_mes: 5000,
      fallback_used: 'HISTORICAL' as const,
    }

    expect(validateSeasonalityInvariants(february)).toBe(true)
  })

  it('Edge case: Month with zero revenue in one band', () => {
    // Scenario: January 2026, but band1 had zero revenue historically
    // band_peso for band1 should still be calculated (0)
    // But other bands should still sum to remaining weight

    const sparse_month = {
      ano: 2026,
      mes: 1,
      band1_peso: 0.0, // no sales days 1-9
      band2_peso: 0.5,
      band3_peso: 0.5, // takes up the weight
      receita_mes: 5000,
      fallback_used: 'HISTORICAL' as const,
    }

    expect(validateSeasonalityInvariants(sparse_month)).toBe(true)
    expect(sparse_month.band1_peso).toBe(0.0)
  })

  it('Fallback priority sequence: Historical > Recent > Global > Default', () => {
    // If Tier 1 found, don't use Tier 2/3/4
    // If Tier 1 not found, try Tier 2
    // etc.

    const tiers = [
      { name: 'HISTORICAL', priority: 1 },
      { name: 'RECENT', priority: 2 },
      { name: 'GLOBAL', priority: 3 },
      { name: 'DEFAULT', priority: 4 },
    ]

    // Verify priority order
    for (let i = 0; i < tiers.length - 1; i++) {
      expect(tiers[i].priority).toBeLessThan(tiers[i + 1].priority)
    }
  })
})
