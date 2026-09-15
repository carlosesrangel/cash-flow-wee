'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

export function AuthEntry() {
  const router = useRouter()

  useEffect(() => {
    let active = true
    let redirected = false
    let fallbackTimer: number | undefined
    const supabase = createBrowserSupabaseClient()
    const url = new URL(window.location.href)
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const isInvite =
      url.searchParams.get('next') === '/auth/set-password' ||
      url.searchParams.get('type') === 'invite' ||
      hashParams.get('type') === 'invite'
    const destination = isInvite ? '/auth/set-password' : '/visao-geral'

    function continueWithSession(hasSession: boolean) {
      if (!active || redirected || !hasSession) return
      redirected = true
      router.replace(destination)
    }

    const { data: authState } = supabase.auth.onAuthStateChange((_event, session) => {
      continueWithSession(Boolean(session))
    })

    void (async () => {
      const { data } = await supabase.auth.getSession()
      if (!active) return

      if (data.session) {
        continueWithSession(true)
      } else if (window.location.hash.includes('access_token')) {
        // The browser client may still be processing the implicit-flow
        // fragment. Give onAuthStateChange a moment before showing an error.
        fallbackTimer = window.setTimeout(() => {
          if (active && !redirected) router.replace('/login?error=invite_invalid')
        }, 4000)
      } else {
        router.replace('/login')
      }
    })()

    return () => {
      active = false
      if (fallbackTimer) window.clearTimeout(fallbackTimer)
      authState.subscription.unsubscribe()
    }
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <p className="text-sm text-neutral-600">Validando seu acesso...</p>
    </main>
  )
}
