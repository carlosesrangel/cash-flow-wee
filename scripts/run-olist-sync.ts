#!/usr/bin/env node
/**
 * Sincronização Olist executada como processo Node comum (fora da Vercel).
 *
 * Por quê: a sincronização inicial completa (histórico de 3650 dias de contas
 * a receber) faz uma chamada de detalhe por registro (~600+ na conta real da
 * WEE) contra um rate limit de 25 req/min da Olist — isso leva ~25 minutos,
 * muito acima do teto de 300s de uma function serverless da Vercel. Rodando
 * aqui (localmente ou no runner do GitHub Actions, que já tem
 * timeout-minutes: 30) o processo tem orçamento de tempo suficiente para
 * terminar. Ver docs/integrations/olist.md e commit desta mudança para
 * detalhes.
 *
 * Uso:
 *   npx tsx scripts/run-olist-sync.ts                  # todas as orgs conectadas, modo incremental
 *   npx tsx scripts/run-olist-sync.ts --org <org-id>    # uma org específica
 *   npx tsx scripts/run-olist-sync.ts --mode initial    # força sync completo (histórico)
 *
 * Requer as mesmas variáveis de .env.local: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, OLIST_CLIENT_ID, OLIST_CLIENT_SECRET,
 * OLIST_STATE_SECRET (dotenv/config carrega .env.local automaticamente
 * quando rodado localmente; no GitHub Actions, os secrets são injetados
 * como env vars pelo workflow).
 *
 * IMPORTANTE: precisa rodar com a flag `--conditions=react-server` (já
 * embutida no script `npm run sync:olist`) — os módulos importados abaixo
 * têm `import 'server-only'`, que lança erro fora dessa condition. A flag
 * precisa estar ativa ANTES do processo Node iniciar, por isso vai no
 * comando (`NODE_OPTIONS`), não dentro deste arquivo.
 */

import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { runOlistSync } from '@/lib/olist/sync'

const ACTIVE_SYNC_STALENESS_MS = 10 * 60 * 1000

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
  const admin = createAdminSupabaseClient()

  let connections: Array<{ org_id: string }>
  if (orgId) {
    connections = [{ org_id: orgId }]
  } else {
    const { data, error } = await admin
      .from('integration_connections')
      .select('org_id')
      .eq('provider', 'olist')
      .eq('status', 'conectado')
    if (error) throw new Error(`Erro ao buscar conexões: ${error.message}`)
    connections = data ?? []
  }

  if (connections.length === 0) {
    console.log('ℹ️  Nenhuma organização com Olist conectada.')
    return
  }

  console.log(`📊 ${connections.length} organização(ões) para sincronizar\n`)

  let failed = 0

  for (const conn of connections) {
    const cutoff = new Date(Date.now() - ACTIVE_SYNC_STALENESS_MS).toISOString()
    const { data: activeSync } = await admin
      .from('sync_runs')
      .select('id')
      .eq('org_id', conn.org_id)
      .eq('status', 'running')
      .gte('started_at', cutoff)
      .limit(1)
      .maybeSingle()

    if (activeSync) {
      console.log(`⏳ Sync já em andamento para ${conn.org_id}, pulando`)
      continue
    }

    const { data: priorSuccess } = await admin
      .from('sync_runs')
      .select('id')
      .eq('org_id', conn.org_id)
      .eq('integration', 'olist')
      .eq('status', 'success')
      .limit(1)
      .maybeSingle()

    const mode = forcedMode ?? (priorSuccess ? 'incremental' : 'initial')

    console.log(`🔄 Sincronizando org ${conn.org_id} (modo: ${mode})...`)
    const startedAt = Date.now()
    try {
      await runOlistSync(conn.org_id, mode, { refreshDerived: !skipDerivedRefresh })
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
