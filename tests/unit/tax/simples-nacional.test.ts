import { describe, it, expect } from 'vitest'
import { calculateEffectiveSimplesTaxRate, projectSimplesTax } from '@/lib/tax/simples-nacional'

/**
 * Golden Dataset 08: Simples Nacional
 *
 * Tests the 6-bracket system with correct nominal-rate/deduction formula
 * Effective Rate = (RBT12 * Nominal - Deduction) / RBT12
 */

describe('Simples Nacional Golden Dataset', () => {
  it('Faixa 1 (até 180k): 4% nominal, 0 deduction', () => {
    // Scenario: RBT12 = 100.000
    // Expected: 4% effective rate

    const result = calculateEffectiveSimplesTaxRate(100000, 2026)

    expect(result.aliquota_nominal).toBe(0.04)
    expect(result.parcela_deduzir).toBe(0)
    expect(result.aliquota_efetiva).toBe(0.04) // (100k * 0.04 - 0) / 100k = 0.04
    expect(result.faixa).toBe('Faixa 1')
  })

  it('Faixa 2 (180k - 360k): 7.3% nominal, 5.940 deduction', () => {
    // Scenario: RBT12 = 300.000
    // Effective = (300.000 * 0.073 - 5.940) / 300.000
    //           = (21.900 - 5.940) / 300.000
    //           = 15.960 / 300.000
    //           = 0.0532 = 5.32%

    const result = calculateEffectiveSimplesTaxRate(300000, 2026)

    expect(result.aliquota_nominal).toBeCloseTo(0.073, 3)
    expect(result.parcela_deduzir).toBe(5940)
    expect(result.aliquota_efetiva).toBeCloseTo(0.0532, 4)
    expect(result.faixa).toBe('Faixa 2')
  })

  it('Faixa 3 (360k - 720k): 9.5% nominal, 13.860 deduction', () => {
    // Scenario: RBT12 = 500.000
    // Effective = (500.000 * 0.095 - 13.860) / 500.000
    //           = (47.500 - 13.860) / 500.000
    //           = 33.640 / 500.000
    //           = 0.06728 = 6.728%

    const result = calculateEffectiveSimplesTaxRate(500000, 2026)

    expect(result.aliquota_nominal).toBe(0.095)
    expect(result.parcela_deduzir).toBe(13860)
    expect(result.aliquota_efetiva).toBeCloseTo(0.06728, 5)
    expect(result.faixa).toBe('Faixa 3')
  })

  it('Faixa 4 (720k - 1.8M): 10.7% nominal, 22.500 deduction', () => {
    // Scenario: RBT12 = 1.000.000
    // Effective = (1.000.000 * 0.107 - 22.500) / 1.000.000
    //           = (107.000 - 22.500) / 1.000.000
    //           = 84.500 / 1.000.000
    //           = 0.0845 = 8.45%

    const result = calculateEffectiveSimplesTaxRate(1000000, 2026)

    expect(result.aliquota_nominal).toBe(0.107)
    expect(result.parcela_deduzir).toBe(22500)
    expect(result.aliquota_efetiva).toBeCloseTo(0.0845, 4)
    expect(result.faixa).toBe('Faixa 4')
  })

  it('Faixa 5 (1.8M - 3.6M): 14.3% nominal, 87.300 deduction', () => {
    // Scenario: RBT12 = 2.500.000
    // Effective = (2.500.000 * 0.143 - 87.300) / 2.500.000
    //           = (357.500 - 87.300) / 2.500.000
    //           = 270.200 / 2.500.000
    //           = 0.10808 = 10.808%

    const result = calculateEffectiveSimplesTaxRate(2500000, 2026)

    expect(result.aliquota_nominal).toBeCloseTo(0.143, 3)
    expect(result.parcela_deduzir).toBe(87300)
    expect(result.aliquota_efetiva).toBeCloseTo(0.10808, 5)
    expect(result.faixa).toBe('Faixa 5')
  })

  it('Faixa 6 (3.6M - 4.8M): 19% nominal, 378.000 deduction', () => {
    // Scenario: RBT12 = 4.000.000
    // Effective = (4.000.000 * 0.19 - 378.000) / 4.000.000
    //           = (760.000 - 378.000) / 4.000.000
    //           = 382.000 / 4.000.000
    //           = 0.0955 = 9.55%

    const result = calculateEffectiveSimplesTaxRate(4000000, 2026)

    expect(result.aliquota_nominal).toBe(0.19)
    expect(result.parcela_deduzir).toBe(378000)
    expect(result.aliquota_efetiva).toBeCloseTo(0.0955, 4)
    expect(result.faixa).toBe('Faixa 6')
  })

  it('Boundary test: exactly at limit', () => {
    // Scenarios at exact boundaries
    const boundaries = [
      { rbt12: 180000, expected_faixa: 'Faixa 1' },
      { rbt12: 180001, expected_faixa: 'Faixa 2' },
      { rbt12: 360000, expected_faixa: 'Faixa 2' },
      { rbt12: 360001, expected_faixa: 'Faixa 3' },
      { rbt12: 720000, expected_faixa: 'Faixa 3' },
      { rbt12: 720001, expected_faixa: 'Faixa 4' },
      { rbt12: 1800000, expected_faixa: 'Faixa 4' },
      { rbt12: 1800001, expected_faixa: 'Faixa 5' },
      { rbt12: 3600000, expected_faixa: 'Faixa 5' },
      { rbt12: 3600001, expected_faixa: 'Faixa 6' },
      { rbt12: 4800000, expected_faixa: 'Faixa 6' },
      { rbt12: 4800001, expected_faixa: 'Fora do Simples' },
    ]

    for (const b of boundaries) {
      const result = calculateEffectiveSimplesTaxRate(b.rbt12, 2026)
      expect(result.faixa).toBe(b.expected_faixa)
    }
  })

  it('2027 Reforma Tributária: Simples Tradicional with CBS/IBS', () => {
    // Scenario: 2027 with Simples Tradicional (CBS/IBS included in DAS)
    // Same RBT12 = 500.000 but with added CBS/IBS premium (~2.5%)

    const result2026 = calculateEffectiveSimplesTaxRate(500000, 2026)
    const result2027 = calculateEffectiveSimplesTaxRate(500000, 2027)

    // 2027 rate should be higher due to CBS/IBS
    expect(result2027.aliquota_efetiva).toBeGreaterThan(result2026.aliquota_efetiva)

    // 2027 nominal increased by ~2.5% (CBS/IBS)
    expect(result2027.aliquota_nominal).toBeCloseTo(result2026.aliquota_nominal + 0.025, 2)
  })

  it('Project Simples tax for competence month', () => {
    // Scenario:
    // - Receita de competência (current month): R$ 100.000
    // - RBT12 (rolling 12M): R$ 1.000.000
    // - Effective rate from RBT12: 8.45%
    // - Tax = 100.000 * 8.45% = R$ 8.450

    const resultado = projectSimplesTax(100000, 1000000, 2026)

    expect(resultado.imposto_simples_projetado).toBe(8450)
    expect(resultado.aliquota_efetiva).toBeCloseTo(0.0845, 4)
    expect(resultado.rbt12).toBe(1000000)
    expect(resultado.faixa).toBe('Faixa 4')
  })

  it('Edge case: zero RBT12 defaults to Faixa 1', () => {
    const result = calculateEffectiveSimplesTaxRate(0, 2026)

    expect(result.faixa).toBe('Faixa 1')
    expect(result.aliquota_efetiva).toBeCloseTo(0.04, 4)
  })

  it('Deduction always reduces effective rate vs nominal', () => {
    // Test that nominal rate > effective rate for all faixas with deduction
    const test_cases = [
      100000, // Faixa 1
      300000, // Faixa 2
      500000, // Faixa 3
      1000000, // Faixa 4
      2500000, // Faixa 5
      4000000, // Faixa 6
    ]

    for (const rbt12 of test_cases) {
      const result = calculateEffectiveSimplesTaxRate(rbt12, 2026)

      if (result.parcela_deduzir > 0) {
        expect(result.aliquota_efetiva).toBeLessThan(result.aliquota_nominal)
      } else {
        expect(result.aliquota_efetiva).toBe(result.aliquota_nominal)
      }
    }
  })
})
