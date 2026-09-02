import { describe, expect, it } from 'vitest'
import { classifyExternalFailure } from '@/lib/observability/telemetry'

describe('secret-free external request telemetry', () => {
  it('separates expected auth errors, unexpected client errors, upstream failures and timeouts', () => {
    expect(classifyExternalFailure(401)).toBe('EXPECTED_4XX')
    expect(classifyExternalFailure(422)).toBe('UNEXPECTED_4XX')
    expect(classifyExternalFailure(503)).toBe('UPSTREAM_5XX')
    expect(classifyExternalFailure(null, Object.assign(new Error('timeout'), { name: 'TimeoutError' }))).toBe('TIMEOUT')
  })
})

