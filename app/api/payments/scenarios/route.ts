import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentMember } from '@/lib/auth/session'
import { loadPaymentScenarios, createPaymentScenario } from '@/lib/payments/engine'

const bodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  adjustments: z.array(
    z.object({
      apId: z.string().uuid(),
      daysDelta: z.number().int().optional(),
      percentage: z.number().min(0).max(100).optional(),
    })
  ),
})

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const scenarios = await loadPaymentScenarios(member.orgId)
    return NextResponse.json({ scenarios })
  } catch (error) {
      // Error suppressed
    return NextResponse.json({ error: 'Failed to load scenarios' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = bodySchema.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 })

  try {
    const scenario = await createPaymentScenario(
      member.orgId,
      body.data.name,
      body.data.description ?? null,
      body.data.adjustments,
      member.profileId
    )
    return NextResponse.json({ scenario })
  } catch (error) {
      // Error suppressed
    return NextResponse.json({ error: 'Failed to create scenario' }, { status: 500 })
  }
}
