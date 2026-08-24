import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { loadTopCustomers, loadCustomerMetrics } from '@/lib/analytics/engine'

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const searchParams = req.nextUrl.searchParams
    const limit = parseInt(searchParams.get('limit') || '10')
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')

    let startDate: Date | undefined
    let endDate: Date | undefined

    if (startDateStr && endDateStr) {
      startDate = new Date(startDateStr)
      endDate = new Date(endDateStr)
    }

    const [topCustomers, allMetrics] = await Promise.all([
      loadTopCustomers(member.orgId, limit, startDate, endDate),
      loadCustomerMetrics(member.orgId, startDate, endDate),
    ])

    return NextResponse.json({
      topCustomers,
      allMetrics,
      count: allMetrics.length,
    })
  } catch (error) {
      // Error suppressed
    return NextResponse.json({ error: 'Failed to load customer analytics' }, { status: 500 })
  }
}
