#!/usr/bin/env node
/**
 * Sincronização SumUp executada como processo Node comum (fora da Vercel).
 *
 * Por quê: sincronizações de SumUp podem levar tempo (transações + payouts
 * de todo o histórico), acima do teto de 300s de uma function serverless da
 * Vercel. Rodando aqui (localmente ou no runner do GitHub Actions, que já tem
 * timeout-minutes: 45) o processo tem orçamento de tempo suficiente para
 * terminar com segurança.
 *
 * Uso:
 *   npx tsx scripts/run-sumup-sync.ts                  # todas as orgs conectadas, modo incremental
 *   npx tsx scripts/run-sumup-sync.ts --org <org-id>   # uma org específica
 *   npx tsx scripts/run-sumup-sync.ts --mode initial   # força sync completo (histórico)
 *
 * Requer as mesmas variáveis de .env.local: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, SUMUP_API_KEY, SUMUP_MERCHANT_CODE, SUMUP_ORG_ID.
 *
 * IMPORTANTE: precisa rodar com a flag `--conditions=react-server` (já
 * embutida no script `npm run sync:sumup`) — os módulos importados abaixo
 * têm `import 'server-only'`, que lança erro fora dessa condition.
 */

import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { runSumupSync } from '@/lib/sumup/sync'

function parseArgs() {
  const args = process.argv.slice(2)
  const orgIndex = args.indexOf('--org')
  const modeIndex = args.indexOf('--mode')
  return {
    orgId: orgIndex >= 0 ? args[orgIndex + 1] : undefined,
    forcedMode: modeIndex >= 0 ? (args[modeIndex + 1] as 'initial' | 'incremental') : undefined,
    skipDerivedRefresh: args.includes('--skip-derived-refresh'),
  }
}

async function main() {
  const { orgId, forcedMode, skipDerivedRefresh } = parseArgs()
  if (forcedMode && !['initial', 'incremental'].includes(forcedMode)) throw new Error('Invalid sync mode')
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUMUP_API_KEY', 'SUMUP_MERCHANT_CODE', 'SUMUP_ORG_ID']
  for (const key of required) if (!process.env[key]) throw new Error(`Missing required secret: ${key}`)
  const admin = createAdminSupabaseClient()

  const targetOrg = orgId ?? process.env.SUMUP_ORG_ID!
  if (orgId && orgId !== process.env.SUMUP_ORG_ID) throw new Error('SumUp API key belongs to a different configured organization')
  const connections = [{ org_id: targetOrg }]
  if (connections.length === 0) throw new Error('No configured integration: synchronization did not run')

  console.log(`📊 ${connections.length} organização(ões) para sincronizar\n`)

  let failed = 0

  for (const conn of connections) {
    const { data: priorSuccess } = await admin
      .from('sync_runs')
      .select('id')
      .eq('org_id', conn.org_id)
      .eq('integration', 'sumup')
      .eq('status', 'success')
      .limit(1)
      .maybeSingle()

    const mode = forcedMode ?? (priorSuccess ? 'incremental' : 'initial')

    console.log(`🔄 Sincronizando org ${conn.org_id} (modo: ${mode})...`)
    const startedAt = Date.now()
    try {
      await runSumupSync(conn.org_id, mode, { refreshDerived: !skipDerivedRefresh })
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
      console.log(`✅ Concluído para ${conn.org_id} em ${elapsedSec}s\n`)
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`❌ Falhou para ${conn.org_id}: ${message}\n`)
    }
  }

  if (failed > 0) {
    console.error(`⚠️  ${failed} organização(ões) falharam`)
    process.exit(1)
  }

  console.log('✅ Sincronização concluída com sucesso')
}

main().catch((err) => {
  console.error('❌ Erro fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
