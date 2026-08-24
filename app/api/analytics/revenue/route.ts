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
    const searchParams = req.nextUrl.searchParams
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')

    let startDate: Date | undefined
    let endDate: Date | undefined
    let daysRange = 90

    if (startDateStr && endDateStr) {
      startDate = new Date(startDateStr)
      endDate = new Date(endDateStr)
      daysRange = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    } else {
      daysRange = 90
    }

    const [timeSeries, monthly, variance, summary] = await Promise.all([
      loadRevenueTimeSeries(member.orgId, daysRange, startDate, endDate),
      loadMonthlyRevenue(member.orgId, 12, startDate, endDate),
      loadRevenueVariance(member.orgId, 12, startDate, endDate),
      loadSalesSummary(member.orgId, startDate, endDate),
    ])

    return NextResponse.json({
      timeSeries,
      monthly,
      variance,
      summary,
    })
  } catch (error) {
      // Error suppressed
    return NextResponse.json({ error: 'Failed to load revenue analytics' }, { status: 500 })
  }
}
