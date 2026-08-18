'use client'

import { useSearchParams, useRouter } from 'next/navigation'

export function PaymentsToggle() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const isEnabled = searchParams.get('payments') !== 'false'

  const handleToggle = () => {
    const params = new URLSearchParams(searchParams)
    params.set('payments', isEnabled ? 'false' : 'true')
    router.push(`?${params.toString()}`)
  }

  return (
    <button
      onClick={handleToggle}
      className={`rounded border px-3 py-1 text-sm font-medium transition ${
        isEnabled ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
      }`}
    >
      {isEnabled ? '✓ Saídas Planejadas' : 'Saídas Planejadas'}
    </button>
  )
}
