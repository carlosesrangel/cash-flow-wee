import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { acceptPendingInvitations } from '@/lib/auth/invitation'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const isInvite = type === 'invite' || searchParams.get('next') === '/auth/set-password'
  const destination = isInvite ? '/auth/set-password' : '/visao-geral'

  if (code || (tokenHash && type)) {
    const supabase = await createServerSupabaseClient()
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! })

    if (!error) {
      if (isInvite) {
        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError || !userData.user) {
          const invalidInviteUrl = new URL('/login', origin)
          invalidInviteUrl.searchParams.set('error', 'invite_invalid')
          return NextResponse.redirect(invalidInviteUrl)
        }

        try {
          await acceptPendingInvitations(userData.user.id)
        } catch {
          const invalidInviteUrl = new URL('/login', origin)
          invalidInviteUrl.searchParams.set('error', 'invite_invalid')
          return NextResponse.redirect(invalidInviteUrl)
        }
      }
      return NextResponse.redirect(`${origin}${destination}`)
    }
  }

  const loginUrl = new URL('/login', origin)
  loginUrl.searchParams.set('error', isInvite ? 'invite_invalid' : 'auth_callback')
  return NextResponse.redirect(loginUrl)
}
