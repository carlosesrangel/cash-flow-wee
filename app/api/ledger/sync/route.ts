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

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { syncLedgerFromAllSources } from '@/lib/ledger/populate'

export async function POST(req: NextRequest) {
  try {
    const admin = createAdminSupabaseClient()

    // For now, extract org_id from query param for development
    // In production, this should authenticate via JWT token from header
    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!orgId) {
      return NextResponse.json({ error: 'org_id required' }, { status: 400 })
    }

    const body = (await req.json().catch(() => ({}))) as { force_refresh?: boolean }

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
