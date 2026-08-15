import { z } from 'zod'

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

export const cashBalanceSnapshotSchema = z.object({
  referenceDate: dateStringSchema,
  bankBalance: z.number(),
  cashOnHand: z.number().nullable().optional(),
  liquidInvestments: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const manualCashEntrySchema = z
  .object({
    type: z.enum(['entrada', 'saida', 'ajuste_saldo']),
    description: z.string().min(1, 'Descrição obrigatória'),
    amount: z.number(),
    entryDate: dateStringSchema,
    justification: z.string().min(1, 'Justificativa obrigatória'),
  })
  .refine((data) => (data.type === 'ajuste_saldo' ? data.amount !== 0 : data.amount > 0), {
    message: 'O valor deve ser positivo para entrada/saída, ou diferente de zero para ajuste de saldo',
    path: ['amount'],
  })

export type CashBalanceSnapshotInput = z.infer<typeof cashBalanceSnapshotSchema>
export type ManualCashEntryInput = z.infer<typeof manualCashEntrySchema>
