import { describe, it, expect } from 'vitest'
import {
  updateForecastEntrySchema,
  createForecastVersionSchema,
  createForecastScenarioSchema,
  updateScenarioMultiplierSchema,
} from '@/lib/validation/forecast'

describe('updateForecastEntrySchema', () => {
  const valid = { versionId: '00000000-0000-4000-8000-000000000002', ano: 2026, mes: 8, receita: 1000 }

  it('accepts a valid entry with optional cenario/comentario', () => {
    expect(updateForecastEntrySchema.safeParse({ ...valid, cenario: 'Base', comentario: 'Ajuste' }).success).toBe(true)
  })

  it('accepts a valid entry without cenario/comentario', () => {
    expect(updateForecastEntrySchema.safeParse(valid).success).toBe(true)
  })

  it('rejects mes outside 1-12', () => {
    expect(updateForecastEntrySchema.safeParse({ ...valid, mes: 13 }).success).toBe(false)
  })

  it('rejects a negative receita', () => {
    expect(updateForecastEntrySchema.safeParse({ ...valid, receita: -1 }).success).toBe(false)
  })

  it('rejects an invalid versionId', () => {
    expect(updateForecastEntrySchema.safeParse({ ...valid, versionId: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('createForecastVersionSchema', () => {
  it('accepts a non-empty name', () => {
    expect(createForecastVersionSchema.safeParse({ name: 'Forecast Setembro 2026' }).success).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(createForecastVersionSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('createForecastScenarioSchema', () => {
  it('accepts a name with no duplicateFromScenarioId', () => {
    expect(createForecastScenarioSchema.safeParse({ name: 'Pessimista' }).success).toBe(true)
  })

  it('accepts a name with a valid duplicateFromScenarioId', () => {
    expect(
      createForecastScenarioSchema.safeParse({
        name: 'Pessimista',
        duplicateFromScenarioId: '00000000-0000-4000-8000-000000000003',
      }).success
    ).toBe(true)
  })

  it('rejects an empty name', () => {
    expect(createForecastScenarioSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

describe('updateScenarioMultiplierSchema', () => {
  const valid = { scenarioId: '00000000-0000-4000-8000-000000000004', ano: 2026, mes: 8, percentual: 85 }

  it('accepts a valid multiplier', () => {
    expect(updateScenarioMultiplierSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a negative percentual', () => {
    expect(updateScenarioMultiplierSchema.safeParse({ ...valid, percentual: -10 }).success).toBe(false)
  })
})
