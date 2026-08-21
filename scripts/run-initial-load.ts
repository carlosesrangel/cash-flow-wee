#!/usr/bin/env node
/**
 * Carga inicial de dados Olist e SumUp no Supabase.
 *
 * Sincroniza o histórico completo (3650 dias) para ambas as integrações
 * de todas as organizações conectadas. Esta é uma operação one-time que
 * geralmente roda apenas uma vez no setup inicial, mas pode ser acionada
 * manualmente se necessário.
 *
 * Uso:
 *   npx tsx scripts/run-initial-load.ts                 # todas as orgs, ambas as integrações
 *   npx tsx scripts/run-initial-load.ts --org <org-id>  # uma org específica
 *   npx tsx scripts/run-initial-load.ts --olist-only    # apenas Olist
 *   npx tsx scripts/run-initial-load.ts --sumup-only    # apenas SumUp
 *
 * Requer as mesmas variáveis de .env.local:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - OLIST_CLIENT_ID, OLIST_CLIENT_SECRET, OLIST_STATE_SECRET (para Olist)
 *   - SUMUP_API_KEY, SUMUP_MERCHANT_CODE (para SumUp)
 *
 * IMPORTANTE: precisa rodar com a flag `--conditions=react-server`
 * (já embutida no script `npm run sync:olist`).
 */

import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { runOlistSync } from '@/lib/olist/sync'
import { runSumupSync } from '@/lib/sumup/sync'

function parseArgs() {
  const args = process.argv.slice(2)
  const orgIndex = args.indexOf('--org')
  const olistOnly = args.includes('--olist-only')
  const sumupOnly = args.includes('--sumup-only')

  return {
    orgId: orgIndex >= 0 ? args[orgIndex + 1] : undefined,
    olistOnly: olistOnly && !sumupOnly,
    sumupOnly: sumupOnly && !olistOnly,
  }
}

async function loadOlist(connections: Array<{ org_id: string }>) {
  console.log('\n📊 Iniciando carga inicial do Olist...\n')

  let failed = 0
  for (const conn of connections) {
    const startedAt = Date.now()
    try {
      console.log(`🔄 Olist: ${conn.org_id}...`)
      await runOlistSync(conn.org_id, 'initial')
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
      console.log(`✅ Olist ${conn.org_id} concluído em ${elapsedSec}s\n`)
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`❌ Olist ${conn.org_id} falhou: ${message}\n`)
    }
  }
  return failed
}

async function loadSumup(connections: Array<{ org_id: string }>) {
  console.log('\n📊 Iniciando carga inicial do SumUp...\n')

  let failed = 0
  for (const conn of connections) {
    const startedAt = Date.now()
    try {
      console.log(`🔄 SumUp: ${conn.org_id}...`)
      await runSumupSync(conn.org_id, 'initial')
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
      console.log(`✅ SumUp ${conn.org_id} concluído em ${elapsedSec}s\n`)
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`❌ SumUp ${conn.org_id} falhou: ${message}\n`)
    }
  }
  return failed
}

async function main() {
  const { orgId, olistOnly, sumupOnly } = parseArgs()
  const admin = createAdminSupabaseClient()

  console.log('🚀 Iniciando carga inicial de dados\n')

  // Buscar conexões válidas
  let connections: Array<{ org_id: string }>
  if (orgId) {
    connections = [{ org_id: orgId }]
  } else {
    // Se --org não foi especificado, buscar ambas as integrações
    // Para inicializar tudo de uma vez
    const { data, error } = await admin
      .from('integration_connections')
      .select('org_id')
      .eq('status', 'conectado')

    if (error) throw new Error(`Erro ao buscar conexões: ${error.message}`)
    // Deduplicate orgs (podem ter múltiplas integrações)
    connections = Array.from(new Map((data ?? []).map((c) => [c.org_id, c])).values())
  }

  if (connections.length === 0) {
    console.log('ℹ️  Nenhuma organização conectada.')
    return
  }

  console.log(`📋 ${connections.length} organização(ões) para carregar\n`)

  let totalFailed = 0

  if (!sumupOnly) {
    const olistFailed = await loadOlist(connections)
    totalFailed += olistFailed
  }

  if (!olistOnly) {
    const sumupFailed = await loadSumup(connections)
    totalFailed += sumupFailed
  }

  if (totalFailed > 0) {
    console.error(`⚠️  ${totalFailed} operação(ões) falharam`)
    process.exit(1)
  }

  console.log('\n✅ Carga inicial concluída com sucesso!')
  console.log('📋 Os dados estão agora sincronizados no Supabase.')
  console.log('⏰ As sincronizações automáticas continuarão rodando conforme configurado.\n')
}

main().catch((err) => {
  console.error('❌ Erro fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
