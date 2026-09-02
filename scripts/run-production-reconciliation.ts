#!/usr/bin/env node
import 'dotenv/config'
import { runReconciliation } from '@/lib/reconciliation/run'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const result = await runReconciliation(orgId)
  console.log(`RECONCILIATION_PROCESSED=${result.processed}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
