import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

const admin = createClient(supabaseUrl, supabaseKey)

async function verifyTable(tableName: string): Promise<{
  table: string
  exists: boolean
  rowCount: number
  minDate?: string
  maxDate?: string
  latestCalculatedAt?: string
}> {
  try {
    const { count, error } = await admin.from(tableName).select('*', { count: 'exact', head: true })

    if (error) {
      return {
        table: tableName,
        exists: false,
        rowCount: 0
      }
    }

    // Get date range if it's a data table
    let minDate = undefined
    let maxDate = undefined
    let latestCalculatedAt = undefined

    if (['sumup_fee_rates_12m', 'sumup_seasonality_3bands_12m', 'sumup_receipt_profile_12m'].includes(tableName)) {
      try {
        const { data: dateData } = await admin
          .from(tableName)
          .select('calculado_em')
          .order('calculado_em', { ascending: true })
          .limit(1)

        if (dateData?.[0]) {
          const { data: latestData } = await admin
            .from(tableName)
            .select('calculado_em')
            .order('calculado_em', { ascending: false })
            .limit(1)

          minDate = dateData[0].calculado_em?.split('T')[0]
          latestCalculatedAt = latestData?.[0]?.calculado_em?.split('T')[0]
        }
      } catch (_) {
        // Date columns may not exist
      }
    }

    if (['sumup_future_receivables', 'financial_ledger'].includes(tableName)) {
      try {
        const { data: dateData } = await admin
          .from(tableName)
          .select('created_at')
          .order('created_at', { ascending: true })
          .limit(1)

        if (dateData?.[0]) {
          const { data: latestData } = await admin
            .from(tableName)
            .select('created_at')
            .order('created_at', { ascending: false })
            .limit(1)

          minDate = dateData[0].created_at?.split('T')[0]
          latestCalculatedAt = latestData?.[0]?.created_at?.split('T')[0]
        }
      } catch (_) {
        // Date columns may not exist
      }
    }

    return {
      table: tableName,
      exists: true,
      rowCount: count || 0,
      minDate,
      maxDate: latestCalculatedAt,
      latestCalculatedAt
    }
  } catch (err) {
    return {
      table: tableName,
      exists: false,
      rowCount: 0
    }
  }
}

async function main() {
  console.log('🔍 PHASE C: Production Database Verification\n')
  console.log(`Database: ${supabaseUrl}\n`)

  const tablesToCheck = [
    'sumup_fee_rates_12m',
    'sumup_seasonality_3bands_12m',
    'sumup_receipt_profile_12m',
    'sumup_future_receivables',
    'financial_ledger',
    'sync_runs',
    'organizations',
  ]

  const results: Awaited<ReturnType<typeof verifyTable>>[] = []

  for (const table of tablesToCheck) {
    const result = await verifyTable(table)
    results.push(result)

    const status = result.exists ? '✅' : '❌'
    const info = result.exists ? ` | ${result.rowCount} rows | Latest: ${result.latestCalculatedAt || result.maxDate || 'N/A'}` : ''
    console.log(`${status} ${result.table}${info}`)
  }

  console.log('\n=== SUMMARY ===\n')
  const existing = results.filter(r => r.exists)
  const missing = results.filter(r => !r.exists)

  console.log(`✅ Existing tables: ${existing.length}`)
  existing.forEach(r => {
    console.log(`   - ${r.table}: ${r.rowCount} rows`)
  })

  if (missing.length > 0) {
    console.log(`\n❌ Missing tables: ${missing.length}`)
    missing.forEach(r => {
      console.log(`   - ${r.table}`)
    })
  }

  const canonicalTablesRequired = [
    'sumup_fee_rates_12m',
    'sumup_seasonality_3bands_12m',
    'sumup_receipt_profile_12m',
    'financial_ledger'
  ]

  const allCanonicalExist = canonicalTablesRequired.every(t => results.find(r => r.table === t && r.exists))

  console.log(`\n${allCanonicalExist ? '✅' : '❌'} Canonical schema complete: ${allCanonicalExist ? 'YES' : 'NO'}`)

  if (allCanonicalExist) {
    const financialLedgerResult = results.find(r => r.table === 'financial_ledger')
    console.log(`\n📊 PRODUCTION_MIGRATION_0023 = VERIFIED`)
    console.log(`   financial_ledger: ${financialLedgerResult?.rowCount || 0} rows`)
    console.log(`   Last ledger entry: ${financialLedgerResult?.latestCalculatedAt || 'N/A'}`)
  } else {
    console.log(`\n❌ PRODUCTION_MIGRATION_0023 = INCOMPLETE`)
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
