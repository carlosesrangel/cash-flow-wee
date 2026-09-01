import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminSupabaseClient()

  const [olist, sumup, analytics, ledger] = await Promise.all([
    admin.from('sync_runs').select('finished_at').eq('org_id', member.orgId).eq('integration', 'olist').eq('status', 'success').order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('sync_runs').select('finished_at').eq('org_id', member.orgId).eq('integration', 'sumup').eq('status', 'success').order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('sumup_fee_rates_12m').select('calculado_em').eq('org_id', member.orgId).order('calculado_em', { ascending: false }).limit(1).maybeSingle(),
    admin.from('financial_ledger').select('created_at').eq('org_id', member.orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  if ([olist, sumup, analytics, ledger].some((query) => query.error)) {
    return NextResponse.json({ error: 'Failed to load freshness' }, { status: 500 })
  }

  return NextResponse.json({
    last_olist_sync: olist.data?.finished_at ?? null,
    last_sumup_sync: sumup.data?.finished_at ?? null,
    last_analytics_refresh: analytics.data?.calculado_em ?? null,
    last_ledger_refresh: ledger.data?.created_at ?? null,
  })
}
