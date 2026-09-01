import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { loadIntegrationFreshness } from '@/lib/integrations/freshness'

export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const freshness = await loadIntegrationFreshness(member.orgId)

  return NextResponse.json({
    last_olist_sync: freshness.lastOlistSync,
    olist_status: freshness.olistStatus,
    last_sumup_sync: freshness.lastSumupSync,
    sumup_status: freshness.sumupStatus,
    last_analytics_refresh: freshness.lastAnalyticsRefresh,
    last_ledger_refresh: freshness.lastLedgerRefresh,
  })
}
