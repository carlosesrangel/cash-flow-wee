import { NextResponse, NextRequest } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { runOlistSync } from '@/lib/olist/sync'

// Mantido apenas para uso pontual/manual — a sincronização diária agendada roda
// via `npm run sync:olist` dentro do GitHub Actions (sem teto de 300s). Ver
// scripts/run-olist-sync.ts e .github/workflows/olist-daily-sync.yml.
export const maxDuration = 300

/**
 * Sincronização em batch de Olist para TODAS as organizações conectadas.
 *
 * Uso: POST /api/integracoes/olist/sync-all
 * Header: Authorization: Bearer {SYNC_API_TOKEN}
 *
 * Chamar periodicamente (ex: GitHub Action diária) para manter dados atualizados.
 * Sincronização é incremental (apenas últimas 24h, não histórico completo).
 */
export async function POST(request: NextRequest) {
  // 1. Validar token de autorização
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token || token !== process.env.SYNC_API_TOKEN) {
    return NextResponse.json(
      { error: 'Token de autorização inválido' },
      { status: 401 }
    )
  }

  try {
    const admin = createAdminSupabaseClient()

    // 2. Buscar todas as organizações com Olist conectada e status 'conectado'
    const { data: connections, error: connError } = await admin
      .from('integration_connections')
      .select('org_id, provider')
      .eq('provider', 'olist')
      .eq('status', 'conectado')

    if (connError) {
      throw new Error(`Erro ao buscar conexões: ${connError.message}`)
    }

    if (!connections || connections.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'Nenhuma organização com Olist conectada',
        synced: 0,
      })
    }

      // Log suppressed

    // 3. Sincronizar cada organização
    const results = {
      synced: 0,
      skipped: 0,
      failed: 0,
      errors: [] as Array<{ orgId: string; error: string }>
    }

    for (const conn of connections) {
      try {
      // Log suppressed

        // Verificar se há sync em andamento
        const { data: activeSyncs } = await admin
          .from('sync_runs')
          .select('id')
          .eq('org_id', conn.org_id)
          .eq('status', 'running')
          .gte('started_at', new Date(Date.now() - 10*60*1000).toISOString())  // 10 min
          .limit(1)
          .maybeSingle()

        if (activeSyncs) {
      // Log suppressed
          results.skipped++
          continue
        }

        // Executar sync (incremental por padrão para GitHub Action)
        await runOlistSync(conn.org_id, 'incremental')
      // Log suppressed
        results.synced++

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
      // Error suppressed
        results.failed++
        results.errors.push({
          orgId: conn.org_id,
          error: errorMsg
        })
      }
    }

    // 4. Retornar resultado
    const allSuccess = results.failed === 0
    return NextResponse.json(
      {
        ok: allSuccess,
        message: allSuccess
          ? 'Sincronização completa'
          : 'Sincronização parcialmente completa com erros',
        synced: results.synced,
        skipped: results.skipped,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined
      },
      { status: allSuccess ? 200 : 207 }  // 207 Multi-Status se houver erros
    )

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido'
      // Error suppressed

    return NextResponse.json(
      {
        ok: false,
        error: errorMsg,
        synced: 0
      },
      { status: 500 }
    )
  }
}

// Adicionar GET para health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Use POST para disparar sincronização',
    endpoint: '/api/integracoes/olist/sync-all'
  })
}
