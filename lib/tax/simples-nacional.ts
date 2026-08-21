/**
 * Simples Nacional + Reforma Tributária 2027
 *
 * CONTEXT:
 * - 2026: Traditional Simples Nacional rates by RBT12 and Anexo
 * - 2027: CBS and IBS integrate into Simples (Reforma Tributária)
 *   * Option A (Simples Tradicional): CBS/IBS included in DAS, no credits
 *   * Option B (Simples Híbrido): CBS/IBS separate, with credit/debit regime
 * - 2027: Cash basis accounting (regime de caixa) ends → accrual basis required
 */

export type SimplesAnexo = 'anexo-i' | 'anexo-ii' | 'anexo-iii' | 'anexo-iv' | 'anexo-v'
export type Simples2027Regime = 'simples-tradicional' | 'simples-hibrido'

export const SIMPLES_ANEXOS: Record<SimplesAnexo, string> = {
  'anexo-i': 'Comércio',
  'anexo-ii': 'Indústria',
  'anexo-iii': 'Serviços',
  'anexo-iv': 'Consultoria/Profissões',
  'anexo-v': 'Transportes/Outros',
}

/**
 * Simples Nacional rates by RBT12 bracket and Anexo (2026 - before tax reform).
 */
export const SIMPLES_RATES_2026: Record<SimplesAnexo, Record<string, number>> = {
  'anexo-i': {
    '180000': 0.0400,
    '360000': 0.0547,
    '540000': 0.0684,
    '720000': 0.0750,
    '900000': 0.0816,
    '1080000': 0.0882,
    '1260000': 0.0927,
    '1500000': 0.0973,
  },
  'anexo-ii': {
    '180000': 0.0450,
    '360000': 0.0597,
    '540000': 0.0734,
    '720000': 0.0800,
    '900000': 0.0866,
    '1080000': 0.0932,
    '1260000': 0.0977,
    '1500000': 0.1023,
  },
  'anexo-iii': {
    '180000': 0.0600,
    '360000': 0.0730,
    '540000': 0.0820,
    '720000': 0.0895,
    '900000': 0.0910,
    '1080000': 0.0925,
    '1260000': 0.0940,
    '1500000': 0.0955,
  },
  'anexo-iv': {
    '180000': 0.0650,
    '360000': 0.0780,
    '540000': 0.0870,
    '720000': 0.0945,
    '900000': 0.0960,
    '1080000': 0.0975,
    '1260000': 0.0990,
    '1500000': 0.1005,
  },
  'anexo-v': {
    '180000': 0.0550,
    '360000': 0.0680,
    '540000': 0.0770,
    '720000': 0.0845,
    '900000': 0.0860,
    '1080000': 0.0875,
    '1260000': 0.0890,
    '1500000': 0.0905,
  },
}

/**
 * 2027 Tax Reform: Simples Tradicional (CBS/IBS within DAS, no credits)
 * Uses 2026 rates + CBS/IBS premium (estimated 2.5%)
 */
export const SIMPLES_RATES_2027_TRADICIONAL: Record<SimplesAnexo, Record<string, number>> = {
  'anexo-i': {
    '180000': 0.0650, // 4.0% + 2.5% CBS/IBS
    '360000': 0.0797,
    '540000': 0.0934,
    '720000': 0.1000,
    '900000': 0.1066,
    '1080000': 0.1132,
    '1260000': 0.1177,
    '1500000': 0.1223,
  },
  'anexo-ii': {
    '180000': 0.0700,
    '360000': 0.0847,
    '540000': 0.0984,
    '720000': 0.1050,
    '900000': 0.1116,
    '1080000': 0.1182,
    '1260000': 0.1227,
    '1500000': 0.1273,
  },
  'anexo-iii': {
    '180000': 0.0850,
    '360000': 0.0980,
    '540000': 0.1070,
    '720000': 0.1145,
    '900000': 0.1160,
    '1080000': 0.1175,
    '1260000': 0.1190,
    '1500000': 0.1205,
  },
  'anexo-iv': {
    '180000': 0.0900,
    '360000': 0.1030,
    '540000': 0.1120,
    '720000': 0.1195,
    '900000': 0.1210,
    '1080000': 0.1225,
    '1260000': 0.1240,
    '1500000': 0.1255,
  },
  'anexo-v': {
    '180000': 0.0800,
    '360000': 0.0930,
    '540000': 0.1020,
    '720000': 0.1095,
    '900000': 0.1110,
    '1080000': 0.1125,
    '1260000': 0.1140,
    '1500000': 0.1155,
  },
}

/**
 * 2027 Tax Reform Constants
 */
export const REFORM_2027 = {
  IBS_RATE: 0.001, // 0.1% transição em 2027
  CBS_RATE: 0.025, // Estimated ~2.5% (será regulamentado)
  DECISION_DEADLINE: '2026-09-30', // Deadline para escolher regime
  EFFECTIVE_DATE: '2027-01-01', // Quando entra em vigor
  CASH_BASIS_END_DATE: '2027-01-01', // Fim do regime de caixa
}

/**
 * Get effective tax rate for given RBT12, Anexo, year, and 2027 regime (if applicable)
 */
export function getSimplesTaxRate(
  rbt12: number,
  anexo: SimplesAnexo = 'anexo-iii',
  year: number = 2026,
  regime2027?: Simples2027Regime
): number {
  let rates: Record<string, number>

  if (year < 2027) {
    rates = SIMPLES_RATES_2026[anexo]
  } else if (regime2027 === 'simples-hibrido') {
    // Simples Híbrido: Simples rate without CBS/IBS (they're outside the DAS)
    // Use 2026 base rate (CBS/IBS removed conceptually)
    rates = SIMPLES_RATES_2026[anexo]
  } else {
    // Simples Tradicional: 2026 rate + CBS/IBS premium
    rates = SIMPLES_RATES_2027_TRADICIONAL[anexo]
  }

  const brackets = Object.entries(rates).sort(([a], [b]) => Number(a) - Number(b))

  for (const [limit, rate] of brackets) {
    if (rbt12 <= Number(limit)) {
      return rate
    }
  }

  return brackets[brackets.length - 1][1]
}

/**
 * Calculate IBS/CBS for Simples Híbrido scenario (2027+)
 * Returns: {ibs, cbs, total}
 */
export function calculateIbsCbsHibrido(
  revenue: number,
  purchases: number,
  eligiblePurchasesPercentage: number = 0.8 // 80% of purchases have eligible IBS/CBS credits
): { ibs: number; cbs: number; creditableAmount: number; netTax: number } {
  const ibsRate = REFORM_2027.IBS_RATE
  const cbsRate = REFORM_2027.CBS_RATE

  // Débito (sales)
  const ibsDebit = revenue * ibsRate
  const cbsDebit = revenue * cbsRate

  // Crédito (eligible purchases)
  const creditablePurchases = purchases * eligiblePurchasesPercentage
  const ibsCredit = creditablePurchases * ibsRate
  const cbsCredit = creditablePurchases * cbsRate

  return {
    ibs: ibsDebit - ibsCredit,
    cbs: cbsDebit - cbsCredit,
    creditableAmount: ibsCredit + cbsCredit,
    netTax: (ibsDebit + cbsDebit) - (ibsCredit + cbsCredit),
  }
}

/**
 * Simulate 2026 vs 2027 tax impact
 */
export function simulate2026vs2027(
  revenue: number,
  purchases: number,
  rbt12: number,
  anexo: SimplesAnexo = 'anexo-iii',
  eligibleCreditPercentage: number = 0.8
): {
  year2026: { simples: number; total: number }
  year2027Tradicional: { simples: number; ibsCbs: number; total: number }
  year2027Hibrido: { simples: number; ibsCbs: number; total: number; creditAdvantage: number }
} {
  // 2026: Simple Simples
  const rate2026 = getSimplesTaxRate(rbt12, anexo, 2026)
  const tax2026 = revenue * rate2026

  // 2027 Tradicional: Simples with CBS/IBS included
  const rate2027Traditional = getSimplesTaxRate(rbt12, anexo, 2027, 'simples-tradicional')
  const tax2027Traditional = revenue * rate2027Traditional

  // 2027 Híbrido: Simples without CBS/IBS + separate IBS/CBS calculation
  const rate2027Hibrido = getSimplesTaxRate(rbt12, anexo, 2027, 'simples-hibrido')
  const simplePart = revenue * rate2027Hibrido
  const ibsCbsPart = calculateIbsCbsHibrido(revenue, purchases, eligibleCreditPercentage)

  return {
    year2026: {
      simples: tax2026,
      total: tax2026,
    },
    year2027Tradicional: {
      simples: tax2027Traditional,
      ibsCbs: 0, // already included
      total: tax2027Traditional,
    },
    year2027Hibrido: {
      simples: simplePart,
      ibsCbs: ibsCbsPart.netTax,
      total: simplePart + ibsCbsPart.netTax,
      creditAdvantage: ibsCbsPart.creditableAmount, // Credit leverage
    },
  }
}

/**
 * Get description of RBT12 bracket
 */
export function getSimplesBracketDescription(rbt12: number): string {
  const brackets = [
    { limit: 180000, label: 'até R$ 180 mil' },
    { limit: 360000, label: 'R$ 180k - 360k' },
    { limit: 540000, label: 'R$ 360k - 540k' },
    { limit: 720000, label: 'R$ 540k - 720k' },
    { limit: 900000, label: 'R$ 720k - 900k' },
    { limit: 1080000, label: 'R$ 900k - 1.08M' },
    { limit: 1260000, label: 'R$ 1.08M - 1.26M' },
    { limit: 1500000, label: 'R$ 1.26M - 1.5M' },
  ]

  for (const bracket of brackets) {
    if (rbt12 <= bracket.limit) {
      return bracket.label
    }
  }

  return 'Acima de R$ 1.5M (fora do Simples Nacional)'
}
