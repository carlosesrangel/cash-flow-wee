#!/usr/bin/env node
/**
 * Check if all required environment variables are configured.
 * Usage: npm run check:env
 */

import 'dotenv/config'
import { validateEnv } from '@/lib/env'

function main() {
  console.log('🔍 Checking environment variables...\n')

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]

  const optional = [
    'OLIST_CLIENT_ID',
    'OLIST_CLIENT_SECRET',
    'OLIST_REDIRECT_URI',
    'OLIST_STATE_SECRET',
    'SUMUP_API_KEY',
    'SUMUP_MERCHANT_CODE',
    'DATABASE_URL',
  ]

  let issues = 0
  let warnings = 0

  // Check required vars
  for (const varName of required) {
    const value = process.env[varName]
    if (!value) {
      console.error(`❌ ${varName} = MISSING`)
      issues++
    } else {
      console.log(`✅ ${varName} = CONFIGURED`)
    }
  }

  // Check optional vars
  for (const varName of optional) {
    const value = process.env[varName]
    if (!value) {
      console.warn(`⚠️  ${varName} = NOT_CONFIGURED`)
      warnings++
    } else {
      console.log(`✅ ${varName} = CONFIGURED`)
    }
  }

  console.log(`\n📊 Summary: ${required.length - issues} required OK, ${optional.length - warnings} optional configured`)

  if (issues > 0) {
    console.error(`\n❌ ${issues} required variables missing!`)
    process.exit(1)
  }

  if (warnings > 0) {
    console.warn(`\n⚠️  ${warnings} optional variables not configured (some features may be disabled)`)
  }

  // Run the actual validation
  try {
    validateEnv('runtime')
    console.log('\n✅ All environment validations passed!')
  } catch (error) {
    if (error instanceof Error) {
      console.error('\n❌ Validation error:', error.message)
    }
    process.exit(1)
  }
}

main()
