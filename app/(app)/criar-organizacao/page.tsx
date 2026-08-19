'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export default function CreateOrganizationPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Nome da organização é obrigatório')
      return
    }

    setLoading(true)
    const supabase = createBrowserSupabaseClient()

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError('Erro ao obter dados do usuário')
        return
      }

      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert([{ name: name.trim() }])
        .select()
        .single()

      if (orgError) {
        setError('Erro ao criar organização: ' + orgError.message)
        return
      }

      if (!org) {
        setError('Erro ao criar organização')
        return
      }

      const { error: memberError } = await supabase
        .from('organization_members')
        .insert([
          {
            org_id: org.id,
            profile_id: user.id,
            role: 'OWNER_ADMIN',
          },
        ])

      if (memberError) {
        setError('Erro ao adicionar você à organização: ' + memberError.message)
        return
      }

      router.push('/visao-geral')
      router.refresh()
    } catch (err) {
      setError('Erro inesperado: ' + (err instanceof Error ? err.message : 'Tente novamente'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Criar Organização</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Crie uma organização para começar a usar o WEE Fluxo de Caixa
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Nome da Organização
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Minha Empresa"
              required
              disabled={loading}
              className="w-full rounded border px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Criando...' : 'Criar Organização'}
          </Button>
        </form>
      </div>
    </main>
  )
}
