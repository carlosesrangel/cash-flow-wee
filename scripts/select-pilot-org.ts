import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

async function selectPilotOrg() {
  const admin = createAdminSupabaseClient()

  console.log('📊 P5: Selecting Pilot Organization\n')

  // Get all orgs
  const { data: orgs } = await admin.from('organizations').select('id, name').limit(20)

  if (!orgs || orgs.length === 0) {
    console.log('❌ No organizations found')
    return
  }

  console.log(`Found ${orgs.length} organizations\n`)

  // For each org, count raw data
  const candidates = []

  for (const org of orgs) {
    const [sumupTx, sumupEvents, olistAr, olistAp, olistOrders] = await Promise.all([
      admin.from('sumup_transactions').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
      admin.from('sumup_transaction_events').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
      admin.from('olist_accounts_receivable').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
      admin.from('olist_accounts_payable').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
      admin.from('olist_orders').select('*', { count: 'exact', head: true }).eq('org_id', org.id),
    ])

    const sumupTxCount = sumupTx.count || 0
    const sumupEventCount = sumupEvents.count || 0
    const olistArCount = olistAr.count || 0
    const olistApCount = olistAp.count || 0
    const olistOrdersCount = olistOrders.count || 0

    const totalDataPoints = sumupTxCount + sumupEventCount + olistArCount + olistApCount + olistOrdersCount

    if (totalDataPoints > 0) {
      candidates.push({
        orgId: org.id,
        orgName: org.name,
        sumupTxCount,
        sumupEventCount,
        olistArCount,
        olistApCount,
        olistOrdersCount,
        totalDataPoints,
        hasAllSources: sumupTxCount > 0 && olistArCount > 0 && olistOrdersCount > 0
      })
    }
  }

  if (candidates.length === 0) {
    console.log('❌ No orgs with data found')
    return
  }

  // Sort by total data points (descending)
  candidates.sort((a, b) => b.totalDataPoints - a.totalDataPoints)

  console.log('Candidates (sorted by data volume):\n')
  candidates.forEach((c, i) => {
    const icon = c.hasAllSources ? '✅' : '⚠️'
    console.log(`${i + 1}. ${icon} ${c.orgName}`)
    console.log(`   SumUp transactions: ${c.sumupTxCount}`)
    console.log(`   SumUp events: ${c.sumupEventCount}`)
    console.log(`   OList A/R: ${c.olistArCount}`)
    console.log(`   OList A/P: ${c.olistApCount}`)
    console.log(`   OList Orders: ${c.olistOrdersCount}`)
    console.log(`   Total data points: ${c.totalDataPoints}`)
    console.log()
  })

  // Select best candidate
  const pilotOrg = candidates[0]

  console.log('=== PILOT ORG SELECTED ===\n')
  console.log(`ORG_NAME = ${pilotOrg.orgName}`)
  console.log(`ORG_ID = ${pilotOrg.orgId}`)
  console.log(`SUMUP_TRANSACTION_COUNT = ${pilotOrg.sumupTxCount}`)
  console.log(`SUMUP_EVENT_COUNT = ${pilotOrg.sumupEventCount}`)
  console.log(`OLIST_AR_COUNT = ${pilotOrg.olistArCount}`)
  console.log(`OLIST_AP_COUNT = ${pilotOrg.olistApCount}`)
  console.log(`OLIST_ORDERS_COUNT = ${pilotOrg.olistOrdersCount}`)
  console.log(`DATA_COVERAGE = ${pilotOrg.hasAllSources ? 'COMPLETE' : 'PARTIAL'}`)
}

selectPilotOrg().catch(err => console.error('Error:', err.message))
