import { describe, it, expect } from 'vitest'
import { computeAgingBucket, AGING_BUCKET_LABEL } from '@/lib/cash-flow/aging'

describe('computeAgingBucket', () => {
  const today = '2026-08-15'

  it('classifies a past date as vencido', () => {
    expect(computeAgingBucket('2026-08-10', today)).toBe('vencido')
  })

  it('classifies today as 0-7', () => {
    expect(computeAgingBucket('2026-08-15', today)).toBe('0-7')
  })

  it('classifies exactly 7 days out as 0-7', () => {
    expect(computeAgingBucket('2026-08-22', today)).toBe('0-7')
  })

  it('classifies 8 days out as 8-15', () => {
    expect(computeAgingBucket('2026-08-23', today)).toBe('8-15')
  })

  it('classifies 16 days out as 16-30', () => {
    expect(computeAgingBucket('2026-08-31', today)).toBe('16-30')
  })

  it('classifies 31 days out as 31-60', () => {
    expect(computeAgingBucket('2026-09-15', today)).toBe('31-60')
  })

  it('classifies 61 days out as 61-90', () => {
    expect(computeAgingBucket('2026-10-15', today)).toBe('61-90')
  })

  it('classifies more than 90 days out as 90+', () => {
    expect(computeAgingBucket('2026-12-15', today)).toBe('90+')
  })
})

describe('AGING_BUCKET_LABEL', () => {
  it('has a Portuguese label for every bucket', () => {
    expect(Object.keys(AGING_BUCKET_LABEL)).toEqual(['vencido', '0-7', '8-15', '16-30', '31-60', '61-90', '90+'])
  })
})
