#!/usr/bin/env node
/**
 * Apply pending migrations to Supabase using direct PostgreSQL connection
 * Usage: npm run apply:migrations
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('❌ Missing DATABASE_URL')
  process.exit(1)
}

const pool = new Pool({ connectionString: databaseUrl })

const MIGRATIONS = [
  '0031_canonical_planning_and_ledger_lineage.sql',
  '0032_rfv_order_source.sql',
]

async function applyMigrations() {
  console.log('📝 Applying pending migrations...\n')

  const client = await pool.connect()

  try {
    for (const migration of MIGRATIONS) {
      const path = join(process.cwd(), 'supabase', 'migrations', migration)
      console.log(`⏳ Applying ${migration}...`)

      try {
        const sql = readFileSync(path, 'utf-8')
        await client.query(sql)
        console.log(`✅ ${migration} applied`)
      } catch (error) {
        console.error(`❌ Failed to apply ${migration}:`, error instanceof Error ? error.message : error)
        throw error
      }
    }

    console.log('\n✅ All migrations applied successfully!')
    console.log(
      '💾 Now seed the data with: npm run seed:forecast:60months && npm run seed:payment-scenarios'
    )
  } finally {
    client.release()
    await pool.end()
  }
}

applyMigrations().catch((err) => {
  console.error('❌ Error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
