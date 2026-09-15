/**
 * POST /api/ledger/sync
 *
 * Synchronize financial ledger from all sources (SumUp, Tiny, forecast, taxes)
 * Idempotent: can be called multiple times safely
 *
 * Body: { force_refresh?: boolean }
 *
 * Returns: sync status and entry counts
 */

import { getCurrentMember } from '@/lib/auth/session'
import { canManageIntegrations } from '@/lib/auth/rbac'
import { NextRequest, NextResponse } from 'next/server'
import { syncLedgerFromAllSources } from '@/lib/ledger/populate'

export async function POST(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageIntegrations(member.role)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  const requestedOrgId = req.nextUrl.searchParams.get('org_id')
  if (requestedOrgId && requestedOrgId !== member.orgId) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  try {
    const orgId = member.orgId

    // Perform ledger sync
    const result = await syncLedgerFromAllSources(orgId)

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          metadata: { org_id: orgId },
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      org_id: orgId,
      total_processed: result.total_processed,
      total_inserted: result.total_inserted,
      total_skipped: result.total_skipped,
      errors: result.errors,
      metadata: {
        calculation_version: 'FINANCIAL_MODEL_V2_EXCEL_PARITY',
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to sync ledger:', error)
    return NextResponse.json({ error: 'Failed to sync ledger' }, { status: 500 })
  }
}
