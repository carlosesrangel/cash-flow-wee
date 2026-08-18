'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export function ForecastToggle() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const showForecast = searchParams.get('forecast') !== 'false'

  function handleToggle() {
    const params = new URLSearchParams(searchParams.toString())
    if (showForecast) {
      params.set('forecast', 'false')
    } else {
      params.delete('forecast')
    }
    router.push(`?${params.toString()}`)
  }

  return (
    <button
      onClick={handleToggle}
      className={`rounded px-3 py-1 text-sm font-medium transition ${
        showForecast ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
      }`}
    >
      {showForecast ? '✓ Forecast' : 'Forecast'}
    </button>
  )
}
