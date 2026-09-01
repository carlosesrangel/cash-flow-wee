import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL

async function verify() {
  const pool = new Pool({ connectionString: databaseUrl })
  
  try {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE 'sumup_%'
      ORDER BY table_name
    `)
    
    console.log('Analytical tables in public schema:')
    if (result.rows.length === 0) {
      console.log('❌ No sumup_* tables found!')
    } else {
      result.rows.forEach(row => console.log(`  ✅ ${row.table_name}`))
    }
    
    // Check if migration 0023 exists
    const migrations = await pool.query(`
      SELECT * FROM _supabase_migrations
      WHERE name LIKE '0023%' OR name LIKE '0024%'
      ORDER BY name
    `)
    
    console.log('\nMigration history:')
    if (migrations.rows.length === 0) {
      console.log('⚠️  No migrations table found')
    } else {
      migrations.rows.forEach(row => console.log(`  ${row.name}: ${row.executed_at ? '✅' : '❌'}`))
    }
  } catch (err: any) {
    console.log('Checking raw schema...')
  } finally {
    await pool.end()
  }
}

verify()
