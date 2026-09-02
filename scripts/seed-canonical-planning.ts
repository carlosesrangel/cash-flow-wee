#!/usr/bin/env node
/** Seed the factual 84-month planning equivalent supplied by the validated workbook. */
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { PLAN_REFERENCE_VALUES } from '@/lib/planning/canonical'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID
const EXPECTED_ROWS = 84
const GOLDEN: Record<string, number> = {
  '2026-09': 39500,
  '2026-10': 55000,
  '2026-12': 115000,
  '2027-01': 27000,
  '2030-12': 350000,
}

function expectedMonths() {
  const result: string[] = []
  for (let year = 2024; year <= 2030; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      result.push(`${year}-${String(month).padStart(2, '0')}`)
    }
  }
  return result
}

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const months = Object.keys(PLAN_REFERENCE_VALUES).sort()
  const expected = expectedMonths()
  if (months.length !== EXPECTED_ROWS) throw new Error(`PLANNING_ROWS_INVALID=${months.length}; esperado ${EXPECTED_ROWS}`)
  if (new Set(months).size !== EXPECTED_ROWS) throw new Error('PLANNING_DUPLICATES_INVALID=1')
  if (months.some((month, index) => month !== expected[index])) throw new Error('PLANNING_MISSING_MONTHS_INVALID=1')
  for (const [month, amount] of Object.entries(GOLDEN)) {
    if (PLAN_REFERENCE_VALUES[month] !== amount) throw new Error(`GOLDEN_CHECK_FAILED=${month}`)
  }

  const client = createAdminSupabaseClient()
  const rows = months.map((month) => ({
    org_id: orgId,
    competence_month: `${month}-01`,
    amount: PLAN_REFERENCE_VALUES[month],
    source_file: 'planejado wee.xlsx (validated-equivalent seed)',
    source_sheet: 'canonical-seed',
    source_row: expected.indexOf(month) + 2,
  }))
  const { error } = await client.from('monthly_sales_plan').upsert(rows, { onConflict: 'org_id,competence_month' })
  if (error) throw error
  const { data, error: verifyError } = await client.from('monthly_sales_plan').select('competence_month, amount').eq('org_id', orgId).order('competence_month')
  if (verifyError) throw verifyError
  const actual = (data ?? []).map((row) => ({ month: String(row.competence_month).slice(0, 7), amount: Number(row.amount) }))
  const actualMonths = actual.map((row) => row.month)
  const actualDuplicates = actualMonths.length - new Set(actualMonths).size
  const missingMonths = expected.filter((month) => !actualMonths.includes(month))
  const actualGolden = Object.fromEntries(Object.keys(GOLDEN).map((month) => [month, actual.find((row) => row.month === month)?.amount ?? null]))
  console.log(JSON.stringify({
    ORG_ID: orgId,
    PLANNING_TOTAL_ROWS: actual.length,
    PLANNING_UNIQUE_MONTHS: new Set(actualMonths).size,
    PLANNING_DUPLICATES: actualDuplicates,
    PLANNING_MISSING_MONTHS: missingMonths.length,
    GOLDEN_CHECKS: actualGolden,
  }, null, 2))
  if (actual.length !== EXPECTED_ROWS || new Set(actualMonths).size !== EXPECTED_ROWS || actualDuplicates !== 0 || missingMonths.length !== 0) {
    throw new Error('PLANNING_RECONCILIATION_FAILED')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
