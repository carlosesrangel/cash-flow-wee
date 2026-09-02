'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    const supabase = createBrowserSupabaseClient()
    await supabase.auth.signOut()
    router.replace('/login')
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
