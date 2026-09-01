import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentMember } from '@/lib/auth/session'
import { loadPayableCandidates } from '@/lib/payments/engine'
import { calculateLedgerBalance } from '@/lib/ledger/populate'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { toLocalDateParam } from '@/lib/integrations/date'

const bodySchema = z.object({ apIds: z.array(z.string().uuid()) })

export async function POST(request: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = bodySchema.safeParse(await request.json())
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 })

  try {
    const admin = createAdminSupabaseClient()
    const candidates = await loadPayableCandidates(member.orgId)
    const selected = candidates.filter((candidate) => body.data.apIds.includes(candidate.apId))
    const saldoAntes = await calculateLedgerBalance(admin, member.orgId, toLocalDateParam(new Date()))
    const pagamentos = selected.reduce((sum, candidate) => sum + candidate.saldo, 0)
    return NextResponse.json({ impact: { contasSelecionadas: selected.length, totalSelecionado: pagamentos, saldoAntes, pagamentos, saldoDepois: saldoAntes - pagamentos } })
  } catch {
    return NextResponse.json({ error: 'Failed to calculate payment impact' }, { status: 500 })
  }
}
