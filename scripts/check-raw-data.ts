import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('📊 Production Raw Data Check\n')

  // Get orgs
  const { data: orgs } = await admin.from('organizations').select('id, name').limit(3)
  console.log(`Organizations: ${orgs?.length || 0}`)
  orgs?.forEach(o => console.log(`  - ${o.name} (${o.id})`))

  if (!orgs?.[0]) {
    console.log('❌ No organizations found')
    return
  }

  const testOrgId = orgs[0].id
  console.log(`\nChecking raw data for org: ${testOrgId}\n`)

  // Check raw sync tables
  const tables = [
    'olist_accounts_receivable',
    'olist_accounts_payable',
    'olist_orders',
    'sumup_transactions',
    'sumup_transaction_events',
    'sumup_payouts',
    'manual_cash_entries',
    'reconciliation_matches'
  ]

  for (const table of tables) {
    const { count } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('org_id', testOrgId)

    console.log(`${table}: ${count || 0} rows`)
  }

  // Check sync_runs
  const { data: syncs } = await admin
    .from('sync_runs')
    .select('*')
    .eq('org_id', testOrgId)
    .order('started_at', { ascending: false })
    .limit(3)

  console.log(`\nRecent syncs:`)
  syncs?.forEach(s => {
    console.log(`  - ${s.integration}: ${s.status} at ${s.started_at}`)
  })
}

main().catch(err => console.error('Error:', err.message))
