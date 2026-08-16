import { describe, it, expect } from 'vitest'
import { applyScenario } from '@/lib/forecast/scenarios'

describe('applyScenario', () => {
  it('multiplies each entry by its matching percentual', () => {
    const result = applyScenario([{ ano: 2026, mes: 8, value: 1000 }], [{ ano: 2026, mes: 8, value: 85 }])
    expect(result).toEqual([{ ano: 2026, mes: 8, value: 850 }])
  })

  it('treats a missing multiplier as 100%, never dropping the month', () => {
    const result = applyScenario([{ ano: 2026, mes: 9, value: 500 }], [])
    expect(result).toEqual([{ ano: 2026, mes: 9, value: 500 }])
  })

  it('applies a different percentual per month independently', () => {
    const result = applyScenario(
      [
        { ano: 2026, mes: 8, value: 1000 },
        { ano: 2026, mes: 9, value: 1000 },
      ],
      [
        { ano: 2026, mes: 8, value: 85 },
        { ano: 2026, mes: 9, value: 115 },
      ]
    )
    expect(result).toEqual([
      { ano: 2026, mes: 8, value: 850 },
      { ano: 2026, mes: 9, value: 1150 },
    ])
  })

  it('returns an empty array for an empty entries list', () => {
    expect(applyScenario([], [{ ano: 2026, mes: 8, value: 85 }])).toEqual([])
  })
})
