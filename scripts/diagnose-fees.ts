import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

async function diagnose() {
  const pool = new Pool({ connectionString: databaseUrl })
  
  try {
    console.log('📊 FEE AMOUNT DIAGNOSIS\n')

    // Transactions
    const txn = await pool.query(`
      SELECT
        COUNT(*) total,
        COUNT(fee_amount) fee_not_null,
        COUNT(*) FILTER (WHERE fee_amount IS NULL) fee_null,
        COUNT(*) FILTER (WHERE fee_amount = 0) fee_zero,
        COUNT(*) FILTER (WHERE fee_amount > 0) fee_positive,
        COALESCE(SUM(fee_amount), 0) fee_sum,
        MIN(fee_amount) fee_min,
        MAX(fee_amount) fee_max,
        COUNT(DISTINCT payment_type) payment_types
      FROM sumup_transactions
      WHERE org_id = $1
    `, [ORG_ID])

    const t = txn.rows[0]
    console.log('sumup_transactions:')
    console.log(`  Total: ${t.total}`)
    console.log(`  NULL fee_amount: ${t.fee_null} (${(t.fee_null/t.total*100).toFixed(1)}%)`)
    console.log(`  Zero fee_amount: ${t.fee_zero}`)
    console.log(`  Positive fee: ${t.fee_positive}`)
    console.log(`  SUM(fee_amount): ${t.fee_sum}`)
    console.log(`  Range: [${t.fee_min}, ${t.fee_max}]`)
    console.log(`  Payment types: ${t.payment_types}`)

    // Check last transaction
    const last = await pool.query(`
      SELECT transaction_id, payment_type, amount, fee_amount, raw
      FROM sumup_transactions
      WHERE org_id = $1
      ORDER BY timestamp_utc DESC
      LIMIT 1
    `, [ORG_ID])

    if (last.rows.length > 0) {
      const row = last.rows[0]
      console.log('\nLast transaction:')
      console.log(`  Transaction: ${row.transaction_id}`)
      console.log(`  Amount: ${row.amount}`)
      console.log(`  Fee: ${row.fee_amount}`)
      if (row.raw) {
        const fees = ['fee', 'fee_amount', 'fees', 'commission', 'merchant_fee', 'payout_fee', 'transaction_fee']
        const foundFees = fees.filter(f => f in row.raw)
        console.log(`  Raw fees fields: ${foundFees.join(', ') || 'none'}`)
        console.log(`  Raw[fee_amount]: ${row.raw.fee_amount}`)
        console.log(`  Raw[fees]: ${row.raw.fees}`)
      }
    }

    // Check transaction_events
    const events = await pool.query(`
      SELECT
        COUNT(*) total,
        COUNT(DISTINCT status) statuses,
        SUM(amount) event_sum
      FROM sumup_transaction_events
      WHERE org_id = $1
    `, [ORG_ID])

    const e = events.rows[0]
    console.log('\nsumup_transaction_events:')
    console.log(`  Total events: ${e.total}`)
    console.log(`  Statuses: ${e.statuses}`)
    console.log(`  SUM(amount): ${e.event_sum}`)

  } finally {
    await pool.end()
  }
}

diagnose().catch(err => console.error('Error:', err.message))
