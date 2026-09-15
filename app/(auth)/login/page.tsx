'use client'
/* eslint-disable react-hooks/set-state-in-effect -- auth callback errors come from the browser URL */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { loginSchema } from '@/lib/validation/auth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get('error')
    if (message === 'invite_invalid') {
      setError('Este convite é inválido ou expirou. Solicite um novo convite.')
    } else if (message === 'auth_callback') {
      setError('Não foi possível validar o link de acesso. Tente novamente.')
    } else if (message === 'no_membership') {
      setError('Seu usuário ainda não foi associado a uma organização. Peça ao administrador para enviar um convite pelo WEE.')
    }
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const parsed = loginSchema.safeParse({ email, password })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dados inválidos')
      return
    }

    setSubmitting(true)
    const supabase = createBrowserSupabaseClient()
    const { error: authError } = await supabase.auth.signInWithPassword(parsed.data)
    setSubmitting(false)

    if (authError) {
      setError('E-mail ou senha inválidos')
      return
    }

    // Do not refresh concurrently with the navigation: the browser client
    // persists the session before replace, and proxy/server components then
    // receive the same auth cookies on the next request.
    router.replace('/visao-geral')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-8 shadow-sm"
      >
        <h1 className="text-xl font-semibold">WEE Fluxo de Caixa</h1>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
