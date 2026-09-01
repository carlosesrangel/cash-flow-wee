import 'dotenv/config'
import { buildAuthorizeUrl, exchangeCodeForTokens } from '@/lib/olist/oauth'

async function testOlistAuth() {
  console.log('=== Testing OLIST Authentication ===\n')

  // Test 1: Build authorize URL
  try {
    console.log('Test 1: Building authorize URL...')
    const orgId = '123e4567-e89b-12d3-a456-426614174000'
    const authUrl = buildAuthorizeUrl(orgId)
    console.log('✓ Authorize URL built successfully')
    console.log('  URL:', authUrl)
    console.log()
  } catch (err) {
    console.error('✗ Failed to build authorize URL:', err instanceof Error ? err.message : err)
    console.log()
  }

  // Test 2: Check environment variables
  try {
    console.log('Test 2: Checking environment variables...')
    const requiredVars = [
      'OLIST_CLIENT_ID',
      'OLIST_CLIENT_SECRET',
      'OLIST_REDIRECT_URI',
      'OLIST_STATE_SECRET'
    ]

    const missing = requiredVars.filter(v => !process.env[v])
    if (missing.length === 0) {
      console.log('✓ All required environment variables are set')
      console.log('  OLIST_CLIENT_ID = CONFIGURED')
      console.log('  OLIST_REDIRECT_URI = CONFIGURED')
    } else {
      console.error('✗ Missing variables:', missing)
    }
    console.log()
  } catch (err) {
    console.error('✗ Error checking env vars:', err)
    console.log()
  }

  // Test 3: Try token exchange with dummy code (should fail at API level, not at env level)
  try {
    console.log('Test 3: Testing token exchange (with dummy code)...')
    try {
      await exchangeCodeForTokens('invalid-code-12345')
    } catch (err) {
      const error = err as Error
      // Check if error is about missing env vars or API error
      if (error.message.includes('must be set')) {
        console.error('✗ Environment variable not set:', error.message)
      } else if (error.message.includes('401') || error.message.includes('invalid_client')) {
        console.log('✓ Environment variables are accessible (auth failed as expected with invalid code)')
      } else {
        console.log('⚠ Unexpected error (may indicate env var issue):')
      }
    }
    console.log()
  } catch (err) {
    console.error('✗ Unexpected error in test 3:', err)
  }

  console.log('=== Test Complete ===')
}

testOlistAuth().catch(console.error)
