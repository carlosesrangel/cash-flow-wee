import { z } from 'zod'

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const updateForecastEntrySchema = z.object({
  versionId: z.string().regex(uuidRegex, 'UUID inválido'),
  ano: z.number().int().min(2000).max(2100),
  mes: z.number().int().min(1).max(12),
  receita: z.number().min(0),
  cenario: z.string().optional(),
  comentario: z.string().max(500).optional(),
})

export const createForecastVersionSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(200),
})

export const createForecastScenarioSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório').max(200),
  duplicateFromScenarioId: z.string().regex(uuidRegex, 'UUID inválido').optional(),
})

export const updateScenarioMultiplierSchema = z.object({
  scenarioId: z.string().regex(uuidRegex, 'UUID inválido'),
  ano: z.number().int().min(2000).max(2100),
  mes: z.number().int().min(1).max(12),
  percentual: z.number().min(0),
})

export type UpdateForecastEntryInput = z.infer<typeof updateForecastEntrySchema>
export type CreateForecastVersionInput = z.infer<typeof createForecastVersionSchema>
export type CreateForecastScenarioInput = z.infer<typeof createForecastScenarioSchema>
export type UpdateScenarioMultiplierInput = z.infer<typeof updateScenarioMultiplierSchema>
