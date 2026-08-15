import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ManualEntryForm } from '@/components/cash-flow/manual-entry-form'

describe('ManualEntryForm', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts the entered values to /api/caixa/ajustes and shows the error message on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Descrição obrigatória' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ManualEntryForm />)
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Aporte dos sócios' } })
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText('Justificativa'), { target: { value: 'Reforço de caixa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }))

    await waitFor(() => expect(screen.getByText('Descrição obrigatória')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/caixa/ajustes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'entrada',
          description: 'Aporte dos sócios',
          amount: 5000,
          entryDate: '2026-08-15',
          justification: 'Reforço de caixa',
        }),
      })
    )
  })
})
