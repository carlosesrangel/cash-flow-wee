import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'
import { readFileSync } from 'fs'

const databaseUrl = process.env.DATABASE_URL

async function applyMigration() {
  const pool = new Pool({ connectionString: databaseUrl })

  try {
    console.log('📦 Applying migration 0023_financial_analytics_layer.sql\n')

    const migrationSql = readFileSync('supabase/migrations/0023_financial_analytics_layer.sql', 'utf-8')

    const client = await pool.connect()
    try {
      await client.query(migrationSql)
      console.log('✅ MIGRATION 0023 = APPLIED\n')
      console.log('Tables created:')
      console.log('  - sumup_fee_rates_12m')
      console.log('  - sumup_seasonality_3bands_12m')
      console.log('  - sumup_receipt_profile_12m')
      console.log('  - financial_ledger')
      console.log('  - forecast_entries')
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
