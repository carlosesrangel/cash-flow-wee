import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'
import { readFileSync } from 'fs'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('❌ DATABASE_URL not found')
  process.exit(1)
}

async function applyMigration() {
  const pool = new Pool({
    connectionString: databaseUrl,
  })

  try {
    console.log('📦 Applying migration 0024_analytical_refresh_functions.sql\n')

    const migrationSql = readFileSync('supabase/migrations/0024_analytical_refresh_functions.sql', 'utf-8')

    // Execute the entire SQL at once - PostgreSQL can handle multiple statements
    const client = await pool.connect()
    try {
      await client.query(migrationSql)
      console.log('✅ MIGRATION 0024 = APPLIED\n')
      console.log('Functions created:')
      console.log('  - refresh_sumup_fee_rates_12m')
      console.log('  - refresh_sumup_seasonality_3bands_12m')
      console.log('  - refresh_sumup_receipt_profile_12m')
      console.log('  - refresh_all_analytical_tables')
    } finally {
      client.release()
    }
  } catch (err: any) {
    console.error('❌ Migration failed:', err.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

applyMigration()
