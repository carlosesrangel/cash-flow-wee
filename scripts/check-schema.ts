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
      WHERE table_schema = 'public' AND table_name = 'sumup_transactions'
      ORDER BY ordinal_position
    `)
    
    console.log('sumup_transactions columns:')
    result.rows.forEach(row => console.log(`  ${row.column_name}: ${row.data_type}`))
    
    // Check for relevant columns
    const cols = result.rows.map(r => r.column_name)
    console.log('\n' + '='.repeat(50))
    console.log('Expected columns status:')
    console.log(`  nro_parcelas_modelo: ${cols.includes('nro_parcelas_modelo') ? '✅' : '❌'}`)
    console.log(`  created_at: ${cols.includes('created_at') ? '✅' : '❌'}`)
    console.log(`  amount_gross: ${cols.includes('amount_gross') ? '✅' : '❌'}`)
    console.log(`  fee: ${cols.includes('fee') ? '✅' : '❌'}`)
    console.log(`  payment_type: ${cols.includes('payment_type') ? '✅' : '❌'}`)
    console.log(`  card_type: ${cols.includes('card_type') ? '✅' : '❌'}`)
  } finally {
    await pool.end()
  }
}

checkSchema()
