import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL

async function checkSchema() {
  const pool = new Pool({ connectionString: databaseUrl })
  
  try {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sumup_transaction_events'
      ORDER BY ordinal_position
    `)
    
    console.log('sumup_transaction_events columns:')
    result.rows.forEach(row => console.log(`  ${row.column_name}: ${row.data_type}`))
  } finally {
    await pool.end()
  }
}

checkSchema()
