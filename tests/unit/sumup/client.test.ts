import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('sumupFetch', () => {
  beforeEach(() => {
    process.env.SUMUP_API_KEY = 'test-api-key'
    process.env.SUMUP_MERCHANT_CODE = 'MC-TEST'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('sends the API key as a Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const { sumupFetch } = await import('@/lib/sumup/client')
    await sumupFetch('/v2.1/merchants/MC-TEST/transactions/history')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.sumup.com/v2.1/merchants/MC-TEST/transactions/history')
    expect(init.headers.Authorization).toBe('Bearer test-api-key')
  })

  it('adds query params to the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const { sumupFetch } = await import('@/lib/sumup/client')
    await sumupFetch('/v2.1/merchants/MC-TEST/transactions/history', { limit: 100, changes_since: '2026-01-01' })

    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(url as string)
    expect(parsed.searchParams.get('limit')).toBe('100')
    expect(parsed.searchParams.get('changes_since')).toBe('2026-01-01')
  })

  it('retries on 429 honoring Retry-After, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name === 'Retry-After' ? '1' : null) },
        text: async () => 'rate limited',
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    const { sumupFetch } = await import('@/lib/sumup/client')
    const promise = sumupFetch('/v2.1/merchants/MC-TEST/transactions/history')
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('throws after exhausting retries on a persistent 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
      text: async () => 'unavailable',
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    const { sumupFetch } = await import('@/lib/sumup/client')
    const promise = sumupFetch('/v2.1/merchants/MC-TEST/transactions/history')
    const assertion = expect(promise).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(10000)
    await assertion
    vi.useRealTimers()
  })

  it('throws immediately on a non-retryable 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => null },
      text: async () => 'bad request',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { sumupFetch } = await import('@/lib/sumup/client')
    await expect(sumupFetch('/v2.1/merchants/MC-TEST/transactions/history')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('getSumupMerchantCode', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns the configured merchant code', async () => {
    process.env.SUMUP_MERCHANT_CODE = 'MC-TEST'
    const { getSumupMerchantCode } = await import('@/lib/sumup/client')
    expect(getSumupMerchantCode()).toBe('MC-TEST')
  })

  it('throws when SUMUP_MERCHANT_CODE is missing', async () => {
    delete process.env.SUMUP_MERCHANT_CODE
    const { getSumupMerchantCode } = await import('@/lib/sumup/client')
    expect(() => getSumupMerchantCode()).toThrow()
  })
})
