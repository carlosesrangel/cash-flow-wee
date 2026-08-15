'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type EntryType = 'entrada' | 'saida' | 'ajuste_saldo'

export function ManualEntryForm() {
  const router = useRouter()
  const [type, setType] = useState<EntryType>('entrada')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [entryDate, setEntryDate] = useState('')
  const [justification, setJustification] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/caixa/ajustes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, description, amount: Number(amount), entryDate, justification }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao lançar ajuste')
      } else {
        setDescription('')
        setAmount('')
        setEntryDate('')
        setJustification('')
        router.refresh()
      }
    } catch {
      setError('Falha ao lançar ajuste')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-type" className="text-xs font-medium text-neutral-600">
          Tipo
        </label>
        <select
          id="entry-type"
          aria-label="Tipo"
          value={type}
          onChange={(e) => setType(e.target.value as EntryType)}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="entrada">Entrada</option>
          <option value="saida">Saída</option>
          <option value="ajuste_saldo">Ajuste de saldo</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-description" className="text-xs font-medium text-neutral-600">
          Descrição
        </label>
        <input
          id="entry-description"
          aria-label="Descrição"
          type="text"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-amount" className="text-xs font-medium text-neutral-600">
          Valor
        </label>
        <input
          id="entry-amount"
          aria-label="Valor"
          type="number"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-date" className="text-xs font-medium text-neutral-600">
          Data
        </label>
        <input
          id="entry-date"
          aria-label="Data"
          type="date"
          required
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="entry-justification" className="text-xs font-medium text-neutral-600">
          Justificativa
        </label>
        <input
          id="entry-justification"
          aria-label="Justificativa"
          type="text"
          required
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Lançar
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
