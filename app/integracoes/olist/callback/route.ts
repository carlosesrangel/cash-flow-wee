import { NextResponse } from 'next/server'
import { verifyState } from '@/lib/olist/state'
import { exchangeCodeForTokens } from '@/lib/olist/oauth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const stateToken = searchParams.get('state')

  const state = stateToken ? verifyState(stateToken) : null

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/integracoes?olist_erro=estado_invalido`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const admin = createAdminSupabaseClient()

    const { error } = await admin.from('integration_connections').upsert(
      {
        org_id: state.orgId,
        provider: 'olist',
        client_id: process.env.OLIST_CLIENT_ID,
        client_secret: process.env.OLIST_CLIENT_SECRET,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.expiresAt.toISOString(),
        status: 'conectado',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,provider' }
    )

    if (error) throw error
  } catch {
    return NextResponse.redirect(`${origin}/integracoes?olist_erro=falha_conexao`)
  }

  return NextResponse.redirect(`${origin}/integracoes?olist_conectado=1`)
}
