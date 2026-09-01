import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(supabaseUrl, supabaseKey)

const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

async function snapshot(label: string) {
  const tables = ['sumup_fee_rates_12m', 'sumup_seasonality_3bands_12m', 'sumup_receipt_profile_12m']
  
  const result: any = {}
  for (const table of tables) {
    const { count } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('org_id', ORG_ID)
    
    result[table] = { count: count || 0 }
  }
  
  console.log(`\n${label}:`)
  Object.entries(result).forEach(([table, data]: any) => {
    console.log(`  ${table}: ${data.count} rows`)
  })
  
  return result
}

async function refresh() {
  const { data, error } = await admin.rpc('refresh_all_analytical_tables', {
    target_org_id: ORG_ID
  })
  
  if (error) throw error
  
  console.log('\nRefresh executed:')
  ;(data || []).forEach((row: any) => {
    console.log(`  ${row.phase}: ${row.rows_affected} rows`)
  })
}

async function main() {
  console.log('🔄 REAL IDEMPOTENCY TEST\n')
  
  const snap1 = await snapshot('SNAPSHOT 1 (BEFORE RUN 1)')
  await refresh()
  const snap2 = await snapshot('SNAPSHOT 2 (AFTER RUN 1)')
  await refresh()
  const snap3 = await snapshot('SNAPSHOT 3 (AFTER RUN 2)')
  
  // Compare
  const tables = ['sumup_fee_rates_12m', 'sumup_seasonality_3bands_12m', 'sumup_receipt_profile_12m']
  console.log('\n✅ IDEMPOTENCY VERIFICATION:')
  
  let allMatch = true
  tables.forEach(table => {
    const match = snap2[table].count === snap3[table].count
    const status = match ? '✅' : '❌'
    console.log(`  ${status} ${table}: RUN2 (${snap2[table].count}) == RUN3 (${snap3[table].count})`)
    if (!match) allMatch = false
  })
  
  console.log(`\n${allMatch ? '✅ REFRESH_IDEMPOTENT = YES' : '❌ REFRESH_IDEMPOTENT = NO'}`)
}

main().catch(err => console.error('Error:', err.message))
