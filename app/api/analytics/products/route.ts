import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/auth/session'
import { loadProductRevenue } from '@/lib/analytics/engine'

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const products = await loadProductRevenue(member.orgId)

    return NextResponse.json({
      products,
      count: products.length,
    })
  } catch (error) {
    console.error('Error loading product analytics:', error)
    return NextResponse.json({ error: 'Failed to load product analytics' }, { status: 500 })
  }
}
