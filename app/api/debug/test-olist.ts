import { NextResponse } from 'next/server'

export async function GET() {
  const tests: Record<string, any> = {}

  // Test 1: Check env vars
  tests.envVars = {
    OLIST_CLIENT_ID: process.env.OLIST_CLIENT_ID ? '✓ SET' : '✗ NOT SET',
    OLIST_CLIENT_SECRET: process.env.OLIST_CLIENT_SECRET ? '✓ SET' : '✗ NOT SET',
    OLIST_REDIRECT_URI: process.env.OLIST_REDIRECT_URI || '✗ NOT SET',
    OLIST_STATE_SECRET: process.env.OLIST_STATE_SECRET ? '✓ SET' : '✗ NOT SET',
  }

  // Test 2: Try building auth URL
  try {
    const { buildAuthorizeUrl } = await import('@/lib/olist/oauth')
    const orgId = 'test-org-123'
    const authUrl = buildAuthorizeUrl(orgId)
    tests.authUrl = { success: true, url: authUrl }
  } catch (err) {
    tests.authUrl = { success: false, error: err instanceof Error ? err.message : String(err) }
  }

  // Test 3: Test API endpoint
  try {
    tests.apiTest = {}
    const tokenUrl = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token'
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.OLIST_CLIENT_ID || 'MISSING',
        client_secret: process.env.OLIST_CLIENT_SECRET || 'MISSING',
        redirect_uri: process.env.OLIST_REDIRECT_URI || 'MISSING',
        code: 'invalid-test-code',
      }).toString(),
    })

    tests.apiTest.status = response.status
    const responseText = await response.text()
    tests.apiTest.response = responseText.slice(0, 200)
  } catch (err) {
    tests.apiTest.error = err instanceof Error ? err.message : String(err)
  }

  return NextResponse.json(tests, { status: 200 })
}
