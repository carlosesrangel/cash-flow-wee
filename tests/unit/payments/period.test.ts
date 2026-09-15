import { expect, it } from 'vitest'
import { paymentPeriodSchema } from '@/lib/payments/period'
import { getCashFlowDateRange } from '@/lib/cash-flow/date-presets'

it.each([{ from: '2026-09-01' }, { to: '2026-09-30' }, { from: '', to: '' }, { from: '2026-09-01', to: '2026-09-30' }])('accepts custom and open intervals %j', period => { expect(paymentPeriodSchema.safeParse(period).success).toBe(true) })
it.each([{ from: '2026-09-30', to: '2026-09-01' }, { from: '2026-02-30' }])('rejects invalid intervals %j', period => { expect(paymentPeriodSchema.safeParse(period).success).toBe(false) })
it('reuses a Monday-to-Sunday week across a month boundary', () => { expect(getCashFlowDateRange('esta-semana', '2026-10-01')).toEqual(['2026-09-28', '2026-10-04']) })
