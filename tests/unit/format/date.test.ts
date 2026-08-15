import { describe, it, expect } from 'vitest'
import { formatDateBR, formatDateOnlyBR, WEE_TIMEZONE } from '@/lib/format/date'

describe('formatDateBR', () => {
  it('formats a Date as dd/MM/yyyy', () => {
    expect(formatDateBR(new Date('2026-08-12T12:00:00Z'))).toBe('12/08/2026')
  })

  it('formats an ISO date string as dd/MM/yyyy', () => {
    expect(formatDateBR('2026-01-05T00:00:00Z')).toBe('04/01/2026')
  })
})

describe('formatDateOnlyBR', () => {
  it('formats a bare YYYY-MM-DD date without any timezone shift', () => {
    expect(formatDateOnlyBR('2026-08-15')).toBe('15/08/2026')
  })

  it('does not shift across a year boundary', () => {
    expect(formatDateOnlyBR('2026-01-01')).toBe('01/01/2026')
  })
})

describe('WEE_TIMEZONE', () => {
  it('is America/Sao_Paulo', () => {
    expect(WEE_TIMEZONE).toBe('America/Sao_Paulo')
  })
})
