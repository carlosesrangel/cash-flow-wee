import { describe, it, expect } from 'vitest'
import { formatBRL } from '@/lib/format/currency'

describe('formatBRL', () => {
  it('formats a positive integer value with thousands separator and comma decimals', () => {
    expect(formatBRL(1234.56)).toBe('R$ 1.234,56')
  })

  it('formats zero', () => {
    expect(formatBRL(0)).toBe('R$ 0,00')
  })

  it('formats negative values with a leading minus', () => {
    expect(formatBRL(-50)).toBe('-R$ 50,00')
  })
})
