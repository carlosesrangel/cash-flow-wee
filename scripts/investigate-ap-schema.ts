import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Pool } from 'pg'

const databaseUrl = process.env.DATABASE_URL
const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

async function investigate() {
  const pool = new Pool({ connectionString: databaseUrl })
  
  try {
    console.log('📋 AP (CONTAS A PAGAR) SCHEMA INVESTIGATION\n')

    // Check table columns
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'olist_accounts_payable'
      ORDER BY ordinal_position
    `)

    console.log('olist_accounts_payable columns:')
    cols.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`)
    })

    // Check data
    const data = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT COALESCE(categoria, 'null')) as categoria_count,
        COUNT(*) FILTER (WHERE categoria IS NULL) as null_categoria,
        COUNT(*) FILTER (WHERE situacao IN ('paga', 'liquidada', 'paid')) as paga_count,
        COUNT(*) FILTER (WHERE saldo = 0) as saldo_zero_count,
        COUNT(*) FILTER (WHERE data_liquidacao IS NOT NULL) as has_liquidacao,
        MIN(data_vencimento) as earliest_due,
        MAX(data_vencimento) as latest_due
      FROM olist_accounts_payable
      WHERE org_id = $1
    `, [ORG_ID])

    const row = data.rows[0]
    console.log('\nolist_accounts_payable data:')
    console.log(`  Total rows: ${row.total}`)
    console.log(`  With category: ${row.total - row.null_categoria} (${row.categoria_count} distinct)`)
    console.log(`  NULL category: ${row.null_categoria}`)
    console.log(`  Status 'paga': ${row.paga_count}`)
    console.log(`  Saldo = 0: ${row.saldo_zero_count}`)
    console.log(`  Has data_liquidacao: ${row.has_liquidacao}`)
    console.log(`  Date range: ${row.earliest_due} to ${row.latest_due}`)

    // Check situacao values
    const sit = await pool.query(`
      SELECT DISTINCT situacao, COUNT(*) cnt
      FROM olist_accounts_payable
      WHERE org_id = $1
      GROUP BY situacao
      ORDER BY cnt DESC
    `, [ORG_ID])

    console.log('\nDistinct situacao values:')
    sit.rows.forEach(r => console.log(`  '${r.situacao}': ${r.cnt} rows`))

    // Sample record
    const sample = await pool.query(`
      SELECT id, fornecedor, historico, categoria, valor, saldo, situacao, data_vencimento, data_liquidacao
      FROM olist_accounts_payable
      WHERE org_id = $1
      ORDER BY data_vencimento DESC
      LIMIT 3
    `, [ORG_ID])

    console.log('\nSample AP records:')
    sample.rows.forEach(r => {
      console.log(`  ${r.fornecedor} | ${r.categoria} | saldo: ${r.saldo} | sit: ${r.situacao} | venc: ${r.data_vencimento}`)
    })

  } finally {
    await pool.end()
  }
}

investigate().catch(err => console.error('Error:', err.message))
