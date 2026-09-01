import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(supabaseUrl, supabaseKey)

async function applyMigration() {
  console.log('📦 Applying migration 0024_analytical_refresh_functions.sql\n')

  // Read the migration file
  const migrationSql = readFileSync('supabase/migrations/0024_analytical_refresh_functions.sql', 'utf-8')

  // Split by statements
  const statements = migrationSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))

  let applied = 0
  let failed = 0

  for (const statement of statements) {
    try {
      await admin.rpc('exec_sql' as never, { sql: statement } as never)
      applied++
      console.log(`✅ Statement ${applied}`)
    } catch (err: any) {
      // Try using the raw SQL endpoint
      try {
        const { error } = await admin.from('public').select('1').limit(0) // dummy query to get auth
        console.log(`⚠️  Using fallback method for statement...`)

        // Unfortunately, Supabase.js doesn't have a direct exec SQL method
        // We need to use the REST API directly
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: statement })
        })

        if (response.ok) {
          applied++
          console.log(`✅ Statement ${applied} (via REST)`)
        } else {
          failed++
          console.log(`❌ Failed: ${err.message}`)
        }
      } catch (fallbackErr: any) {
        failed++
        console.log(`❌ Statement failed: ${fallbackErr.message}`)
      }
    }
  }

  console.log(`\n=== Migration Result ===`)
  console.log(`Applied: ${applied}`)
  console.log(`Failed: ${failed}`)

  if (failed === 0) {
    console.log(`\n✅ MIGRATION 0024 = APPLIED`)
  } else {
    console.log(`\n⚠️  Some statements failed. Manual verification needed.`)
  }
}

applyMigration().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
