import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { BalanceForm } from '@/components/cash-flow/balance-form'

describe('BalanceForm', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('posts the entered values to /api/caixa/saldo and shows the error message on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Não autorizado' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BalanceForm />)
    fireEvent.change(screen.getByLabelText('Saldo bancário'), { target: { value: '12000' } })
    fireEvent.change(screen.getByLabelText('Data de referência'), { target: { value: '2026-08-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar saldo' }))

    await waitFor(() => expect(screen.getByText('Não autorizado')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/caixa/saldo',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ referenceDate: '2026-08-15', bankBalance: 12000 }),
      })
    )
  })
})
