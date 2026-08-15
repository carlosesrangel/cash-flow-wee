'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function BalanceForm() {
  const router = useRouter()
  const [referenceDate, setReferenceDate] = useState('')
  const [bankBalance, setBankBalance] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/caixa/saldo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referenceDate, bankBalance: Number(bankBalance) }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao registrar saldo')
      } else {
        setReferenceDate('')
        setBankBalance('')
        router.refresh()
      }
    } catch {
      setError('Falha ao registrar saldo')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="balance-reference-date" className="text-xs font-medium text-neutral-600">
          Data de referência
        </label>
        <input
          id="balance-reference-date"
          aria-label="Data de referência"
          type="date"
          required
          value={referenceDate}
          onChange={(e) => setReferenceDate(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="balance-bank-balance" className="text-xs font-medium text-neutral-600">
          Saldo bancário
        </label>
        <input
          id="balance-bank-balance"
          aria-label="Saldo bancário"
          type="number"
          step="0.01"
          required
          value={bankBalance}
          onChange={(e) => setBankBalance(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Registrar saldo
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
