import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL

async function check() {
  const pool = new Pool({ connectionString: databaseUrl })
  
  try {
    const result = await pool.query(`
      SELECT
        count(*) as total_rows,
        count(case when card_type is null then 1 end) as null_card_types,
        count(case when payment_type is null then 1 end) as null_payment_types
      FROM sumup_transactions
      WHERE org_id = '30805a10-b85f-4ac0-bd1a-899f93678725'
    `)
    
    console.log('sumup_transactions for pilot org (carlos):')
    const row = result.rows[0]
    console.log(`  Total rows: ${row.total_rows}`)
    console.log(`  NULL card_type: ${row.null_card_types}`)
    console.log(`  NULL payment_type: ${row.null_payment_types}`)
  } finally {
    await pool.end()
  }
}

check()
