import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { loadProductRevenue } from '@/lib/analytics/engine'

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const searchParams = req.nextUrl.searchParams
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')

    let startDate: Date | undefined
    let endDate: Date | undefined

    if (startDateStr && endDateStr) {
      startDate = new Date(startDateStr)
      endDate = new Date(endDateStr)
    }

    const products = await loadProductRevenue(member.orgId, startDate, endDate)

    return NextResponse.json({
      products,
      count: products.length,
    })
  } catch (error) {
      // Error suppressed
    return NextResponse.json({ error: 'Failed to load product analytics' }, { status: 500 })
  }
}
