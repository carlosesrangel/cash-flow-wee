import { test, expect } from '@playwright/test'

test.describe('API authentication boundary', () => {
  const protectedEndpoints = [
    { method: 'GET', path: '/api/analytics/fees' },
    { method: 'GET', path: '/api/analytics/seasonality' },
    { method: 'GET', path: '/api/cash-flow/summary' },
    { method: 'GET', path: '/api/ledger/audit-duplicates' },
    { method: 'GET', path: '/api/ledger/balance' },
    { method: 'POST', path: '/api/ledger/sync' },
    { method: 'POST', path: '/api/forecast/projected-receipts' },
    { method: 'GET', path: '/api/test' },
  ] as const

  for (const endpoint of protectedEndpoints) {
    test(`${endpoint.method} ${endpoint.path} rejects unauthenticated access`, async ({ request }) => {
      const response = endpoint.method === 'GET'
        ? await request.get(endpoint.path)
        : await request.post(endpoint.path, { data: {} })

      expect(response.status()).toBe(401)
    })
  }
})
