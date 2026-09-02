import { describe, expect, it } from 'vitest'
import { buildPayableCategoryUpdate } from '@/lib/olist/sync/payable-category-backfill'

describe('buildPayableCategoryUpdate', () => {
  it('returns only factual detail fields that changed', () => {
    expect(buildPayableCategoryUpdate(
      { categoria: null, categoria_id: null, valor_pago: null, data_liquidacao: null },
      { id: 1, categoria: { id: 7, descricao: ' Fornecedores ' }, valorPago: 25, dataLiquidacao: '2026-09-01' },
    )).toEqual({ categoria_id: 7, categoria: 'Fornecedores', valor_pago: 25, data_liquidacao: '2026-09-01' })
  })

  it('returns no update when the detail is already persisted', () => {
    expect(buildPayableCategoryUpdate(
      { categoria: 'Fornecedores', categoria_id: 7, valor_pago: 25, data_liquidacao: '2026-09-01' },
      { id: 1, categoria: { id: 7, descricao: 'Fornecedores' }, valorPago: 25, dataLiquidacao: '2026-09-01' },
    )).toEqual({})
  })

  it('keeps a source-without-category detail idempotent while persisting payment facts once', () => {
    const payable = { categoria: null, categoria_id: null, valor_pago: 25, data_liquidacao: '2026-09-01' }
    const detail = { id: 1, categoria: null, valorPago: 25, dataLiquidacao: '2026-09-01' }
    expect(buildPayableCategoryUpdate(payable, detail)).toEqual({})
  })
})
