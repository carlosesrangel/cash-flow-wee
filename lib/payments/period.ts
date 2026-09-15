import { z } from 'zod'

const optionalDate = z.union([z.literal(''), z.string().date()]).optional()
export const paymentPeriodSchema = z.object({ from: optionalDate, to: optionalDate }).refine(p => !p.from || !p.to || p.from <= p.to, { message: 'A data inicial deve ser anterior ou igual à data final.' })
export type PaymentPeriod = z.infer<typeof paymentPeriodSchema>
