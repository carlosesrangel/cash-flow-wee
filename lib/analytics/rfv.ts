/**
 * RFV (Recency, Frequency, Value) segmentation for customer analysis.
 *
 * Each dimension is scored 1-5 (5 being best):
 * - Recency: Days since last order (lower = better, so 0-30 days = 5)
 * - Frequency: Order count (1 = 1, 2-3 = 2, 4-6 = 3, 7-15 = 4, 16+ = 5)
 * - Value: Lifetime value (quartiles)
 *
 * Customers are then segmented by their combined RFV score.
 */

export interface RFVScore {
  recencyScore: 1 | 2 | 3 | 4 | 5
  frequencyScore: 1 | 2 | 3 | 4 | 5
  valueScore: 1 | 2 | 3 | 4 | 5
  rfvSegment: 'Champions' | 'Loyalists' | 'At Risk' | 'Need Attention' | 'New' | 'Dormant'
  totalScore: number
}

export function calculateRFVScore(
  daysSinceLastOrder: number | undefined,
  orderCount: number,
  lifetimeValue: number,
  allValues: number[], // all LTV values for quartile calculation
): RFVScore {
  // Recency: days since last order
  let recencyScore: 1 | 2 | 3 | 4 | 5
  if (daysSinceLastOrder === undefined) {
    recencyScore = 1 // No orders = worst
  } else if (daysSinceLastOrder <= 30) {
    recencyScore = 5
  } else if (daysSinceLastOrder <= 60) {
    recencyScore = 4
  } else if (daysSinceLastOrder <= 120) {
    recencyScore = 3
  } else if (daysSinceLastOrder <= 180) {
    recencyScore = 2
  } else {
    recencyScore = 1
  }

  // Frequency: order count
  let frequencyScore: 1 | 2 | 3 | 4 | 5
  if (orderCount >= 16) {
    frequencyScore = 5
  } else if (orderCount >= 7) {
    frequencyScore = 4
  } else if (orderCount >= 4) {
    frequencyScore = 3
  } else if (orderCount >= 2) {
    frequencyScore = 2
  } else {
    frequencyScore = 1
  }

  // Value: lifetime value (quartiles)
  const sortedValues = [...allValues].sort((a, b) => a - b)
  const q1 = sortedValues[Math.floor(sortedValues.length * 0.25)]
  const q2 = sortedValues[Math.floor(sortedValues.length * 0.5)]
  const q3 = sortedValues[Math.floor(sortedValues.length * 0.75)]

  let valueScore: 1 | 2 | 3 | 4 | 5
  if (lifetimeValue >= q3) {
    valueScore = 5
  } else if (lifetimeValue >= q2) {
    valueScore = 4
  } else if (lifetimeValue >= q1) {
    valueScore = 3
  } else if (lifetimeValue > 0) {
    valueScore = 2
  } else {
    valueScore = 1
  }

  // Segment based on combined scores
  const totalScore = recencyScore + frequencyScore + valueScore
  const avgScore = totalScore / 3

  let rfvSegment: 'Champions' | 'Loyalists' | 'At Risk' | 'Need Attention' | 'New' | 'Dormant'
  if (orderCount === 0) {
    rfvSegment = 'New'
  } else if (recencyScore === 1) {
    rfvSegment = 'Dormant' // Hasn't purchased in a long time
  } else if (avgScore >= 4.5) {
    rfvSegment = 'Champions' // Best customers
  } else if (avgScore >= 3.5) {
    rfvSegment = 'Loyalists' // Good customers
  } else if (frequencyScore <= 2 && recencyScore <= 2) {
    rfvSegment = 'At Risk' // Low engagement and low recent activity
  } else {
    rfvSegment = 'Need Attention' // Medium attention required
  }

  return {
    recencyScore,
    frequencyScore,
    valueScore,
    rfvSegment,
    totalScore,
  }
}

/**
 * Returns badge styling for RFV segment
 */
export function getRFVSegmentBadge(
  segment: 'Champions' | 'Loyalists' | 'At Risk' | 'Need Attention' | 'New' | 'Dormant'
): {
  bgColor: string
  textColor: string
  label: string
  emoji: string
} {
  const config = {
    Champions: {
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-800 dark:text-blue-200',
      label: 'Champions',
      emoji: '🏆',
    },
    Loyalists: {
      bgColor: 'bg-green-100',
      textColor: 'text-green-800 dark:text-green-200',
      label: 'Loyalists',
      emoji: '💚',
    },
    'At Risk': {
      bgColor: 'bg-red-100',
      textColor: 'text-red-800 dark:text-red-200',
      label: 'At Risk',
      emoji: '⚠️',
    },
    'Need Attention': {
      bgColor: 'bg-yellow-100',
      textColor: 'text-yellow-800 dark:text-yellow-200',
      label: 'Need Attention',
      emoji: '👀',
    },
    New: {
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-800 dark:text-purple-200',
      label: 'New',
      emoji: '✨',
    },
    Dormant: {
      bgColor: 'bg-gray-100',
      textColor: 'text-gray-800 dark:text-gray-200',
      label: 'Dormant',
      emoji: '😴',
    },
  }

  return config[segment]
}
