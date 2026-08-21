import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { loadTopCustomers, loadCustomerMetrics } from '@/lib/analytics/engine'

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '10')
    const [topCustomers, allMetrics] = await Promise.all([
      loadTopCustomers(member.orgId, limit),
      loadCustomerMetrics(member.orgId),
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
