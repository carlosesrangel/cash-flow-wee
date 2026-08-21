import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentMember } from '@/lib/auth/session'
import { loadPlannedPayments, savePlannedPayment, deletePlannedPayment } from '@/lib/payments/engine'

const querySchema = z.object({ orgId: z.string().uuid() })
const bodySchema = z.object({ apId: z.string().uuid(), plannedDate: z.string().date() })

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const payments = await loadPlannedPayments(member.orgId)
    return NextResponse.json({ payments })
  } catch (error) {
      // Error suppressed
    return NextResponse.json({ error: 'Failed to load payments' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = bodySchema.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 })

  try {
    await savePlannedPayment(member.orgId, body.data.apId, body.data.plannedDate, member.profileId)
    return NextResponse.json({ ok: true })
  } catch (error) {
      // Error suppressed
    return NextResponse.json({ error: 'Failed to save payment' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apId = req.nextUrl.searchParams.get('apId')
  if (!apId) return NextResponse.json({ error: 'Missing apId' }, { status: 400 })

  try {
    await deletePlannedPayment(member.orgId, apId)
    return NextResponse.json({ ok: true })
  } catch (error) {
      // Error suppressed
    return NextResponse.json({ error: 'Failed to delete payment' }, { status: 500 })
  }
}
