'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { setPasswordSchema } from '@/lib/validation/auth'

export default function SetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    let active = true

    void supabase.auth.getUser().then(({ data }) => {
      if (active) setCheckingSession(!data.user)
      if (active && !data.user) setError('Este convite é inválido ou expirou. Solicite um novo convite.')
    })

    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const parsed = setPasswordSchema.safeParse({ password, passwordConfirmation })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Confira os dados informados')
      return
    }

    setSubmitting(true)
    const supabase = createBrowserSupabaseClient()
    const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.password })
    setSubmitting(false)

    if (updateError) {
      setError('Não foi possível definir a senha. Solicite um novo convite se o link tiver expirado.')
      return
    }

    router.replace('/visao-geral')
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Ative seu acesso</h1>
          <p className="mt-1 text-sm text-neutral-600">Crie uma senha para entrar no WEE Cash Flow.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">Nova senha</label>
          <input id="password" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded border px-3 py-2 text-sm" disabled={checkingSession || submitting} required />
        </div>
        <div className="space-y-1">
          <label htmlFor="password-confirmation" className="text-sm font-medium">Confirmar senha</label>
          <input id="password-confirmation" type="password" minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} className="w-full rounded border px-3 py-2 text-sm" disabled={checkingSession || submitting} required />
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={checkingSession || submitting || Boolean(error && !password)} className="w-full rounded bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50">
          {submitting ? 'Salvando...' : 'Definir senha e entrar'}
        </button>
      </form>
    </main>
  )
}
