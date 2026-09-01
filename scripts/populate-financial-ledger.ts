import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(supabaseUrl, supabaseKey)

const ORG_ID = '30805a10-b85f-4ac0-bd1a-899f93678725'

async function populate() {
  console.log('📝 POPULATING FINANCIAL LEDGER\n')

  // Clear existing
  const { error: delError } = await admin
    .from('financial_ledger')
    .delete()
    .eq('org_id', ORG_ID)
  
  if (delError) console.warn('Warning on delete:', delError.message)

  // 1. SumUp transactions (ENTRADA - payout received)
  const { data: sumupTxns } = await admin
    .from('sumup_transactions')
    .select('id, timestamp_utc, amount, payment_type, simple_status')
    .eq('org_id', ORG_ID)
  
  const sumupEntries = (sumupTxns || []).map((txn: any) => ({
    org_id: ORG_ID,
    event_date: new Date(txn.timestamp_utc).toISOString().split('T')[0],
    direction: 'entrada', // money received
    amount: txn.amount,
    nature: 'SUMUP_PAYOUT_ACTUAL',
    source: 'sumup',
    source_id: txn.id,
    status: 'actual',
    is_actual: true,
    is_scheduled: false,
    is_projected: false,
  }))

  console.log(`  SumUp transactions (ENTRADA): ${sumupEntries.length}`)

  // 2. SumUp events - future payout (ENTRADA - scheduled)
  const { data: events } = await admin
    .from('sumup_transaction_events')
    .select('id, due_date, amount')
    .eq('org_id', ORG_ID)
  
  const eventEntries = (events || [])
    .filter((evt: any) => evt.due_date > new Date().toISOString().split('T')[0]) // future only
    .map((evt: any) => ({
      org_id: ORG_ID,
      event_date: evt.due_date,
      direction: 'entrada',
      amount: evt.amount,
      nature: 'SUMUP_RECEIPT_SCHEDULED',
      source: 'sumup',
      source_event_id: evt.id,
      status: 'scheduled',
      is_actual: false,
      is_scheduled: true,
      is_projected: false,
    }))

  console.log(`  SumUp events (scheduled ENTRADA): ${eventEntries.length}`)

  // 3. Batch insert
  const allEntries = [...sumupEntries, ...eventEntries]
  
  if (allEntries.length === 0) {
    console.log('❌ No entries to insert')
    return
  }

  const { error: insertError } = await admin
    .from('financial_ledger')
    .insert(allEntries)
  
  if (insertError) {
    console.error('❌ Insert error:', insertError.message)
    return
  }

  console.log(`✅ Inserted ${allEntries.length} entries`)

  // 4. Verify
  const { data: ledger } = await admin
    .from('financial_ledger')
    .select('nature, status')
    .eq('org_id', ORG_ID)
  
  const byNature = (ledger || []).reduce((acc: any, r: any) => {
    acc[r.nature] = (acc[r.nature] || 0) + 1
    return acc
  }, {})

  const byStatus = (ledger || []).reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})

  console.log('\n📊 Ledger breakdown:')
  console.log('  By nature:', byNature)
  console.log('  By status:', byStatus)

  const total = ledger?.length || 0
  console.log(`\n✅ LEDGER_ROWS = ${total}`)
  console.log(`✅ LEDGER_IDEMPOTENT = Ready for test`)
}

populate().catch(err => console.error('Error:', err.message))
