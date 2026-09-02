'use client'

import { useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

export function SignOutButton({ className }: { className?: string }) {
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createBrowserSupabaseClient()
    await supabase.auth.signOut()
    // Force the next request through proxy after the auth cookies are cleared.
    window.location.assign('/login')
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className={className ?? 'text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-50'}
    >
      {signingOut ? 'Saindo...' : 'Sair'}
    </button>
  )
}
