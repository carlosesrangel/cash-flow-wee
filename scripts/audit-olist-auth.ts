#!/usr/bin/env node
import 'dotenv/config'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { refreshTokens } from '@/lib/olist/oauth'

const orgId = process.argv[2] ?? process.env.WEE_ORG_ID

async function main() {
  if (!orgId) throw new Error('Informe o org_id como primeiro argumento ou WEE_ORG_ID')
  const admin = createAdminSupabaseClient()
  const [{ data: connection, error: connectionError }, { data: syncRuns, error: syncError }] = await Promise.all([
    admin.from('integration_connections').select('id, org_id, status, expires_at, access_token, refresh_token, connected_at, updated_at').eq('org_id', orgId).eq('provider', 'olist').maybeSingle(),
    admin.from('sync_runs').select('started_at, finished_at, status, error_message, records_received').eq('org_id', orgId).eq('integration', 'olist').order('started_at', { ascending: false }).limit(5),
  ])
  if (connectionError) throw connectionError
  if (syncError) throw syncError
  if (!connection) { console.log(JSON.stringify({ ACCESS_TOKEN_STATUS: 'missing', REFRESH_TOKEN_AVAILABLE: false, ORG_ASSOCIATION: 'missing' }, null, 2)); return }

  const accessExpired = !connection.expires_at || new Date(connection.expires_at).getTime() <= Date.now()
  const base = {
    ACCESS_TOKEN_STATUS: accessExpired ? 'expired' : 'not_expired',
    ACCESS_TOKEN_EXPIRY: connection.expires_at,
    REFRESH_TOKEN_AVAILABLE: Boolean(connection.refresh_token),
    REFRESH_TOKEN_EXPIRY: 'Olist does not return a refresh-token expiry in the token response; provider expiry is not observable here',
    LAST_REFRESH_ATTEMPT: null as string | null,
    REFRESH_RESULT: 'not_attempted',
    ERROR_CODE: null as string | null,
    ERROR_BODY: null as string | null,
    TOKEN_PERSISTENCE: 'not_attempted',
    ORG_ASSOCIATION: connection.org_id === orgId ? 'pass' : 'fail',
    CONNECTION_STATUS_BEFORE: connection.status,
    LAST_SYNC: syncRuns?.[0] ?? null,
  }
  if (!connection.refresh_token) { console.log(JSON.stringify(base, null, 2)); return }

  base.LAST_REFRESH_ATTEMPT = new Date().toISOString()
  try {
    const tokens = await refreshTokens(connection.refresh_token)
    const { error } = await admin.from('integration_connections').update({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, expires_at: tokens.expiresAt.toISOString(), status: 'conectado', updated_at: new Date().toISOString() }).eq('id', connection.id).eq('org_id', orgId)
    if (error) throw new Error(`TOKEN_PERSISTENCE ${error.message}`)
    base.REFRESH_RESULT = 'success'
    base.TOKEN_PERSISTENCE = 'pass'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = message.match(/token request failed \((\d+)\)/i)?.[1] ?? null
    base.ERROR_CODE = status ?? (message.match(/invalid_grant|invalid_client|unauthorized_client/i)?.[0] ?? 'unknown')
    base.ERROR_BODY = message.replace(/^.*?: /, '').slice(0, 300)
    base.REFRESH_RESULT = 'failed'
    base.TOKEN_PERSISTENCE = 'not_attempted'
  }
  console.log(JSON.stringify(base, null, 2))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
