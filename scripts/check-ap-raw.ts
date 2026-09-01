import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

async function check() {
  const pool = new Pool({ connectionString: databaseUrl })
  
  try {
    const sample = await pool.query(`
      SELECT raw, historico, situacao, valor
      FROM olist_accounts_payable
      WHERE org_id = $1
      ORDER BY synced_at DESC
      LIMIT 2
    `, [ORG_ID])

    console.log('Sample AP raw JSON structure:\n')
    sample.rows.forEach((r, i) => {
      console.log(`Record ${i+1}:`)
      console.log(`  Historico: ${r.historico}`)
      console.log(`  Situacao: ${r.situacao}`)
      console.log(`  Valor: ${r.valor}`)
      console.log(`  Raw keys: ${r.raw ? Object.keys(r.raw).join(', ') : 'null'}`)
      if (r.raw) {
        console.log(`  Raw.categoria: ${r.raw.categoria}`)
        console.log(`  Raw.category: ${r.raw.category}`)
        console.log(`  Raw.natureza: ${r.raw.natureza}`)
      }
      console.log()
    })

    // Check situacao values and what indicates "paid"
    const sit = await pool.query(`
      SELECT DISTINCT situacao
      FROM olist_accounts_payable
      WHERE org_id = $1
      ORDER BY situacao
    `, [ORG_ID])

    console.log('Distinct situacao values:')
    sit.rows.forEach(r => console.log(`  ${r.situacao}`))

  } finally {
    await pool.end()
  }
}

check().catch(err => console.error('Error:', err.message))
