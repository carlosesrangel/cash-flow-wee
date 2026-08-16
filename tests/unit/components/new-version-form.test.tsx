import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { NewVersionForm } from '@/components/forecast/new-version-form'

describe('NewVersionForm', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts the entered name to /api/forecast/versoes and shows the error message on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Não autorizado' }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<NewVersionForm />)
    fireEvent.change(screen.getByLabelText('Nome da nova versão'), { target: { value: 'Forecast Setembro 2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar versão' }))

    await waitFor(() => expect(screen.getByText('Não autorizado')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/forecast/versoes',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Forecast Setembro 2026' }) })
    )
  })
})
