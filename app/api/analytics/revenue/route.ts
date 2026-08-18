import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import {
  loadRevenueTimeSeries,
  loadMonthlyRevenue,
  loadRevenueVariance,
  loadSalesSummary,
} from '@/lib/analytics/engine'

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [timeSeries, monthly, variance, summary] = await Promise.all([
      loadRevenueTimeSeries(member.orgId, 90),
      loadMonthlyRevenue(member.orgId, 12),
      loadRevenueVariance(member.orgId, 12),
      loadSalesSummary(member.orgId),
    ])

    return NextResponse.json({
      timeSeries,
      monthly,
      variance,
      summary,
    })
  } catch (error) {
    console.error('Error loading revenue analytics:', error)
    return NextResponse.json({ error: 'Failed to load revenue analytics' }, { status: 500 })
  }
}
