/**
 * Environment variable validation.
 * Runs at build time to ensure all required variables are configured.
 */

const requiredPublicVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]

const requiredServerVars = [
  'SUPABASE_SERVICE_ROLE_KEY',
]

// Optional server variables with defaults
const optionalServerVars: Record<string, string> = {
  'OLIST_RATE_LIMIT_PER_MINUTE': '25',
}

export function validateEnv(stage: 'build' | 'runtime' = 'runtime') {
  const missing: string[] = []
  const errors: string[] = []

  // Validate public vars (available in browser)
  for (const varName of requiredPublicVars) {
    if (!process.env[varName]) {
      missing.push(varName)
    }
  }

  // Validate server vars (only on server/build)
  if (stage === 'build' || typeof window === 'undefined') {
    for (const varName of requiredServerVars) {
      if (!process.env[varName]) {
        missing.push(varName)
      }
    }
  }

  if (missing.length > 0) {
    errors.push(`Missing required environment variables: ${missing.join(', ')}`)
  }

  // Validate Supabase URL format
  if (process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('https://')) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL')
  }

  if (errors.length > 0) {
    const message = errors.join('\n')
    if (stage === 'build') {
      throw new Error(`Environment validation failed:\n${message}`)
    }
    console.error(`Environment validation failed:\n${message}`)
  }

  return true
}

export const env = {
  // Public vars (browser-safe)
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',

  // Server vars (server-only)
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  olistClientId: process.env.OLIST_CLIENT_ID,
  olistClientSecret: process.env.OLIST_CLIENT_SECRET,
  olistRedirectUri: process.env.OLIST_REDIRECT_URI,
  olistStateSecret: process.env.OLIST_STATE_SECRET,
  olistRateLimitPerMinute: Number(process.env.OLIST_RATE_LIMIT_PER_MINUTE || optionalServerVars.OLIST_RATE_LIMIT_PER_MINUTE),
  sumupApiKey: process.env.SUMUP_API_KEY,
  sumupMerchantCode: process.env.SUMUP_MERCHANT_CODE,
  databaseUrl: process.env.DATABASE_URL,
} as const
