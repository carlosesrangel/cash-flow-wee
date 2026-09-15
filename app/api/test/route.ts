import { getCurrentMember } from '@/lib/auth/session'
import { NextResponse } from 'next/server'

export async function GET() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, message: 'API routes are working!' })
}
