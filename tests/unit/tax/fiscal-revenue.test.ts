import { describe, expect, it } from 'vitest'
import { fiscalRevenueDate, isValidFiscalRevenue } from '@/lib/tax/fiscal-revenue'

describe('fiscal revenue source', () => {
  it('does not use order date or SumUp receipt date as a billing-date fallback', () => {
    const preInvoice = { data: '2026-08-10', data_faturamento: null, valor_total_pedido: 1000, situacao: 'aprovado' }
    expect(isValidFiscalRevenue(preInvoice)).toBe(false)
    expect(fiscalRevenueDate(preInvoice)).toBeNull()
  })

  it('accepts only positive non-cancelled invoiced orders', () => {
    expect(isValidFiscalRevenue({ data_faturamento: '2026-08-12', valor_total_pedido: 1000, situacao: 'faturado' })).toBe(true)
    expect(isValidFiscalRevenue({ data_faturamento: '2026-08-12', valor_total_pedido: 1000, situacao: 'cancelado' })).toBe(false)
  })
})
