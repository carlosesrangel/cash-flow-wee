#!/usr/bin/env node
import 'dotenv/config'
import { loadComparableUniverse } from '@/lib/reconciliation/comparable-universe'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const { report } = await loadComparableUniverse(orgId)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
