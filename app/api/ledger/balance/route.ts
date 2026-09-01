/**
 * GET /api/ledger/balance
 *
 * Query financial ledger with balance calculations
 *
 * Query params:
 * - from_date: ISO date start (inclusive)
 * - to_date: ISO date end (inclusive)
 * - include_status: comma-separated (actual,scheduled,projected) default: actual
 * - group_by: none|day|month|year|source (default: none)
 *
 * Returns: ledger entries with running balance and summary
 */

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminSupabaseClient()

    // For development: extract org_id from query param
    const orgId = req.nextUrl.searchParams.get('org_id')
    if (!orgId) {
      return NextResponse.json({ error: 'org_id required' }, { status: 400 })
    }
    const searchParams = req.nextUrl.searchParams
    const fromDate = searchParams.get('from_date')
    const toDate = searchParams.get('to_date')
    const includeStatus = (searchParams.get('include_status') || 'actual').split(',')
    const groupBy = searchParams.get('group_by') || 'none'

    // Load ledger entries
    let query = admin
      .from('financial_ledger')
      .select('*')
      .eq('org_id', orgId)
      .in('status', includeStatus)
      .order('event_date', { ascending: true })

    if (fromDate) {
      query = query.gte('event_date', fromDate)
    }
    if (toDate) {
      query = query.lte('event_date', toDate)
    }

    const { data: entries, error } = await query

    if (error) {
      throw error
    }

    // Calculate running balance
    let runningBalance = 0
    const withBalance = (entries || []).map((entry) => {
      const amount = entry.direction === 'entrada' ? entry.amount : -entry.amount
      runningBalance += amount
      return {
        ...entry,
        balance_after: runningBalance,
      }
    })

    // Group results
    let grouped = withBalance
    if (groupBy === 'month') {
      const byMonth = new Map<string, any>()
      for (const entry of withBalance) {
        const month = entry.event_date.substring(0, 7) // YYYY-MM
        if (!byMonth.has(month)) {
          byMonth.set(month, {
            period: month,
            entries: [],
            total_entrada: 0,
            total_saida: 0,
            count: 0,
            balance_end: 0,
          })
        }
        const group = byMonth.get(month)
        group.entries.push(entry)
        if (entry.direction === 'entrada') {
          group.total_entrada += entry.amount
        } else {
          group.total_saida += entry.amount
        }
        group.count += 1
        group.balance_end = entry.balance_after
      }
      grouped = Array.from(byMonth.values())
    } else if (groupBy === 'source') {
      const bySource = new Map<string, any>()
      for (const entry of withBalance) {
        if (!bySource.has(entry.source)) {
          bySource.set(entry.source, {
            source: entry.source,
            entries: [],
            total_entrada: 0,
            total_saida: 0,
            count: 0,
          })
        }
        const group = bySource.get(entry.source)
        group.entries.push(entry)
        if (entry.direction === 'entrada') {
          group.total_entrada += entry.amount
        } else {
          group.total_saida += entry.amount
        }
        group.count += 1
      }
      grouped = Array.from(bySource.values())
    }

    // Calculate summary
    const summary = {
      total_entrada: withBalance.reduce((s, e) => s + (e.direction === 'entrada' ? e.amount : 0), 0),
      total_saida: withBalance.reduce((s, e) => s + (e.direction === 'saida' ? e.amount : 0), 0),
      net_balance: withBalance.length > 0 ? withBalance[withBalance.length - 1].balance_after : 0,
      count_entries: withBalance.length,
      first_date: withBalance.length > 0 ? withBalance[0].event_date : null,
      last_date: withBalance.length > 0 ? withBalance[withBalance.length - 1].event_date : null,
    }

    return NextResponse.json({
      success: true,
      org_id: orgId,
      summary,
      entries: groupBy === 'none' ? withBalance.slice(0, 200) : grouped,
      count_entries: withBalance.length,
      grouped_by: groupBy,
      filters: {
        from_date: fromDate,
        to_date: toDate,
        include_status: includeStatus,
      },
      metadata: {
        calculation_version: 'FINANCIAL_MODEL_V2_EXCEL_PARITY',
      },
    })
  } catch (error) {
    console.error('Failed to query ledger balance:', error)
    return NextResponse.json({ error: 'Failed to query ledger balance' }, { status: 500 })
  }
}
