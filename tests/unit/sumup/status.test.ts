import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/sumup/client', () => ({
  sumupFetch: vi.fn(),
  getSumupMerchantCode: vi.fn(() => 'MC-TEST'),
}))

import { sumupFetch } from '@/lib/sumup/client'

const ORIGINAL_ENV = { ...process.env }

describe('checkSumupStatus', () => {
  beforeEach(() => {
    process.env.SUMUP_API_KEY = 'test-key'
    process.env.SUMUP_MERCHANT_CODE = 'MC-TEST'
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns configurado when env vars are set and the test call succeeds', async () => {
    vi.mocked(sumupFetch).mockResolvedValue({ items: [], links: [] })

    const { checkSumupStatus } = await import('@/lib/sumup/status')
    expect(await checkSumupStatus()).toBe('configurado')
  })

  it('returns erro_configuracao when SUMUP_API_KEY is missing', async () => {
    delete process.env.SUMUP_API_KEY

    const { checkSumupStatus } = await import('@/lib/sumup/status')
    expect(await checkSumupStatus()).toBe('erro_configuracao')
    expect(sumupFetch).not.toHaveBeenCalled()
  })

  it('returns erro_configuracao when the test call fails', async () => {
    vi.mocked(sumupFetch).mockRejectedValue(new Error('401 unauthorized'))

    const { checkSumupStatus } = await import('@/lib/sumup/status')
    expect(await checkSumupStatus()).toBe('erro_configuracao')
  })
})
