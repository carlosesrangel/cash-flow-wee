import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(supabaseUrl, supabaseKey)

async function main() {
  console.log('📋 Checking RPC functions in database\n')

  // Try to get all functions from information_schema
  const { data, error } = await admin.rpc('exec_sql' as never, {
    sql: "SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name LIKE 'refresh%'"
  } as never)

  if (error) {
    console.log('Direct query failed, trying alternative...')
    
    // Try listing with simple query
    const { data: test } = await admin
      .from('pg_proc')
      .select('proname')
      .eq('pronamespace', 2200)
    
    console.log('Test query result:', test)
  } else {
    console.log('Functions found:', data)
  }

  // Try calling one directly
  console.log('\nTrying to call refresh_sumup_fee_rates_12m directly...')
  const { data: result, error: callError } = await admin.rpc('refresh_sumup_fee_rates_12m', {
    target_org_id: '30805a10-b85f-4ac0-bd1a-899f93678725'
  })

  if (callError) {
    console.log('❌ Error:', callError.message)
  } else {
    console.log('✅ Success:', result)
  }
}

main().catch(err => console.error('Error:', err.message))
