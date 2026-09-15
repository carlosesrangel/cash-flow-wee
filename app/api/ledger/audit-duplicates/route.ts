/**
 * GET /api/ledger/audit-duplicates
 *
 * Audit ledger for potential duplicate entries
 * Uses rules to identify double-counting risks
 *
 * Returns: list of duplicate candidates with confidence scores
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getCurrentMember } from '@/lib/auth/session'
import { NextRequest, NextResponse } from 'next/server'
import { auditLedgerForDuplicates } from '@/lib/deduplication/rules'

export async function GET(req: NextRequest) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestedOrgId = req.nextUrl.searchParams.get('org_id')
  if (requestedOrgId && requestedOrgId !== member.orgId) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
  }

  try {
    const admin = createAdminSupabaseClient()

    const orgId = member.orgId

    // Run audit
    const result = await auditLedgerForDuplicates(admin, orgId)

    // Group by confidence
    const byConfidence = {
      HIGH: result.candidates.filter((c) => c.confidence === 'HIGH'),
      MEDIUM: result.candidates.filter((c) => c.confidence === 'MEDIUM'),
      LOW: result.candidates.filter((c) => c.confidence === 'LOW'),
    }

    return NextResponse.json({
      success: true,
      org_id: orgId,
      total_checked: result.total_checked,
      duplicates_found: result.duplicates_found,
      by_confidence: {
        HIGH: byConfidence.HIGH.length,
        MEDIUM: byConfidence.MEDIUM.length,
        LOW: byConfidence.LOW.length,
      },
      candidates: result.candidates,
      rules_applied: result.rules_applied,
      health_check: {
        is_healthy: result.duplicates_found === 0,
        critical_issues: byConfidence.HIGH.length,
        warning_issues: byConfidence.MEDIUM.length,
      },
      metadata: {
        calculation_version: 'FINANCIAL_MODEL_V2_EXCEL_PARITY',
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to audit duplicates:', error)
    return NextResponse.json({ error: 'Failed to audit duplicates' }, { status: 500 })
  }
}
