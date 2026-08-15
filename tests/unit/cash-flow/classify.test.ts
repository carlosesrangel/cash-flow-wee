import { describe, it, expect } from 'vitest'
import { classifyAccountsReceivable, classifyAccountsPayable } from '@/lib/cash-flow/classify'

describe('classifyAccountsReceivable', () => {
  const base = {
    valor: 380,
    saldo: 380,
    situacao: 'aberto',
    data_vencimento: '2026-09-01',
    data_liquidacao: null as string | null,
  }

  it('classifies saldo > 0 as contratado, dated by data_vencimento with no other date available', () => {
    const result = classifyAccountsReceivable(base, null)
    expect(result).toEqual({ included: true, bucket: 'contratado', date: '2026-09-01' })
  })

  it('classifies saldo === 0 as realizado', () => {
    const result = classifyAccountsReceivable({ ...base, saldo: 0 }, null)
    expect(result).toEqual({ included: true, bucket: 'realizado', date: '2026-09-01' })
  })

  it('prefers data_liquidacao over data_vencimento when present', () => {
    const result = classifyAccountsReceivable({ ...base, data_liquidacao: '2026-08-28' }, null)
    expect(result).toEqual({ included: true, bucket: 'contratado', date: '2026-08-28' })
  })

  it('prefers the reconciled SumUp cash date over both Olist dates', () => {
    const result = classifyAccountsReceivable({ ...base, data_liquidacao: '2026-08-28' }, '2026-08-25')
    expect(result).toEqual({ included: true, bucket: 'contratado', date: '2026-08-25' })
  })

  it('excludes situacao = cancelado', () => {
    const result = classifyAccountsReceivable({ ...base, situacao: 'cancelado' }, null)
    expect(result).toEqual({ included: false, reason: 'cancelado' })
  })

  it('excludes an unrecognized situacao as situacao_desconhecida, never guessing a bucket', () => {
    const result = classifyAccountsReceivable({ ...base, situacao: 'em_analise' }, null)
    expect(result).toEqual({ included: false, reason: 'situacao_desconhecida' })
  })

  it('excludes a row with no resolvable date as dados_incompletos, never fabricating one', () => {
    const result = classifyAccountsReceivable({ ...base, data_vencimento: null }, null)
    expect(result).toEqual({ included: false, reason: 'dados_incompletos' })
  })

  it('excludes a row with null valor as dados_incompletos', () => {
    const result = classifyAccountsReceivable({ ...base, valor: null }, null)
    expect(result).toEqual({ included: false, reason: 'dados_incompletos' })
  })
})

describe('classifyAccountsPayable', () => {
  const base = {
    valor: 500,
    saldo: 500,
    situacao: 'aberto',
    data_vencimento: '2026-09-01',
  }

  it('classifies saldo > 0 as contratado', () => {
    expect(classifyAccountsPayable(base)).toEqual({ included: true, bucket: 'contratado', date: '2026-09-01' })
  })

  it('classifies saldo === 0 as realizado', () => {
    expect(classifyAccountsPayable({ ...base, saldo: 0 })).toEqual({
      included: true,
      bucket: 'realizado',
      date: '2026-09-01',
    })
  })

  it('excludes situacao = cancelado', () => {
    expect(classifyAccountsPayable({ ...base, situacao: 'cancelado' })).toEqual({
      included: false,
      reason: 'cancelado',
    })
  })

  it('excludes an unrecognized situacao as situacao_desconhecida', () => {
    expect(classifyAccountsPayable({ ...base, situacao: 'protestado' })).toEqual({
      included: false,
      reason: 'situacao_desconhecida',
    })
  })

  it('excludes a row with no data_vencimento as dados_incompletos', () => {
    expect(classifyAccountsPayable({ ...base, data_vencimento: null })).toEqual({
      included: false,
      reason: 'dados_incompletos',
    })
  })
})
