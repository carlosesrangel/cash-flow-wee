import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { assessFinancialParity } from '@/lib/financial/parity'

export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminSupabaseClient()
  const [dimensions, transactions, transactionsWithFee, seasonality, receiptProfile] = await Promise.all([
    admin.from('sumup_fee_rates_12m').select('payment_type', { count: 'exact', head: true }).eq('org_id', member.orgId),
    admin.from('sumup_transactions').select('id', { count: 'exact', head: true }).eq('org_id', member.orgId),
    admin.from('sumup_transactions').select('id', { count: 'exact', head: true }).eq('org_id', member.orgId).not('fee_amount', 'is', null),
    admin.from('sumup_seasonality_3bands_12m').select('id', { count: 'exact', head: true }).eq('org_id', member.orgId),
    admin.from('sumup_receipt_profile_12m').select('id', { count: 'exact', head: true }).eq('org_id', member.orgId),
  ])

  const errors = [dimensions, transactions, transactionsWithFee, seasonality, receiptProfile].filter((query) => query.error)
  if (errors.length > 0) return NextResponse.json({ error: 'Failed to load parity metrics' }, { status: 500 })

  const metrics = {
    feeDimensionRows: dimensions.count ?? 0,
    transactions: transactions.count ?? 0,
    transactionsWithFee: transactionsWithFee.count ?? 0,
    seasonalityRows: seasonality.count ?? 0,
    receiptProfileRows: receiptProfile.count ?? 0,
  }

  return NextResponse.json({ metrics, parity: assessFinancialParity(metrics) })
}
