'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function NewVersionForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/forecast/versoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao criar versão')
      } else {
        setName('')
        router.refresh()
      }
    } catch {
      setError('Falha ao criar versão')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="new-version-name" className="text-xs font-medium text-neutral-600">
          Nome da nova versão
        </label>
        <input
          id="new-version-name"
          aria-label="Nome da nova versão"
          type="text"
          required
          placeholder="Ex.: Forecast Setembro 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Criar versão
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
