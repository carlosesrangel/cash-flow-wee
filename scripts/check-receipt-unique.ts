import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL

async function check() {
  const pool = new Pool({ connectionString: databaseUrl })
  
  try {
    // Check unique constraint name
    const result = await pool.query(`
      SELECT constraint_name, column_name
      FROM information_schema.constraint_column_usage
      WHERE table_schema = 'public' AND table_name = 'sumup_receipt_profile_12m'
      AND constraint_name LIKE '%_key'
      ORDER BY constraint_name, ordinal_position
    `)
    
    console.log('Unique constraints on sumup_receipt_profile_12m:')
    result.rows.forEach(row => console.log(`  ${row.constraint_name}: ${row.column_name}`))
    
    // Check columns
    const cols = await pool.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sumup_receipt_profile_12m'
      ORDER BY ordinal_position
    `)
    
    console.log('\nColumns:')
    cols.rows.forEach(row => console.log(`  ${row.column_name}: ${row.is_nullable}`))
  } finally {
    await pool.end()
  }
}

check()
