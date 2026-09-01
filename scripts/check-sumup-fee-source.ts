import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

async function check() {
  const pool = new Pool({ connectionString: databaseUrl })
  
  try {
    console.log('🔍 SUMUP FEE SOURCE ANALYSIS\n')

    // Check sumup_transactions columns more thoroughly
    const cols = await pool.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sumup_transactions'
      AND column_name LIKE '%fee%' OR column_name LIKE '%commission%' OR column_name LIKE '%payout%'
      ORDER BY column_name
    `)

    console.log('sumup_transactions columns with fee/commission/payout:')
    if (cols.rows.length === 0) {
      console.log('  (none)')
    } else {
      cols.rows.forEach(row => console.log(`  ${row.column_name}: nullable=${row.is_nullable}`))
    }

    // Check transaction_events
    const eventCols = await pool.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sumup_transaction_events'
      ORDER BY column_name
    `)

    console.log('\nsumup_transaction_events columns:')
    eventCols.rows.forEach(row => console.log(`  ${row.column_name}`))

    // Check raw data structure in last transaction
    const sample = await pool.query(`
      SELECT id, transaction_id, KEYS(raw) as raw_keys, raw
      FROM sumup_transactions
      WHERE org_id = $1 AND raw IS NOT NULL
      ORDER BY timestamp_utc DESC
      LIMIT 1
    `, [ORG_ID])

    if (sample.rows.length > 0) {
      console.log('\nSample raw data structure:')
      console.log(JSON.stringify(sample.rows[0], null, 2))
    }

    // Check if there's a payout_plan value
    const payouts = await pool.query(`
      SELECT DISTINCT payout_plan, COUNT(*) cnt
      FROM sumup_transactions
      WHERE org_id = $1
      GROUP BY payout_plan
    `, [ORG_ID])

    console.log('\nPayout plans:')
    payouts.rows.forEach(row => console.log(`  ${row.payout_plan}: ${row.cnt} txns`))

  } finally {
    await pool.end()
  }
}

check().catch(err => console.error('Error:', err.message))
