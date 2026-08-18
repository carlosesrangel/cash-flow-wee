import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { PlanningGrid } from '@/components/forecast/planning-grid'

describe('PlanningGrid', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows read-only values when canEdit is false', () => {
    render(
      <PlanningGrid versionId="v-1" entries={[{ ano: 2026, mes: 8, value: 1000 }]} canEdit={false} />
    )

    expect(screen.getByText('2026')).toBeTruthy()
    expect(screen.queryByLabelText('Ago 2026')).toBeNull()
  })

  it('posts the edited cell to /api/forecast/entradas on blur when canEdit is true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <PlanningGrid versionId="v-1" entries={[{ ano: 2026, mes: 8, value: 1000 }]} canEdit={true} />
    )

    fireEvent.change(screen.getByLabelText('Ago 2026'), { target: { value: '1500' } })
    fireEvent.blur(screen.getByLabelText('Ago 2026'))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/forecast/entradas',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ versionId: 'v-1', ano: 2026, mes: 8, receita: 1500 }),
        })
      )
    )
  })

  it('shows the returned error message when the save fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Não autorizado' }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<PlanningGrid versionId="v-1" entries={[{ ano: 2026, mes: 8, value: 1000 }]} canEdit={true} />)

    fireEvent.change(screen.getByLabelText('Ago 2026'), { target: { value: '1500' } })
    fireEvent.blur(screen.getByLabelText('Ago 2026'))

    await waitFor(() => expect(screen.getByText('Não autorizado')).toBeTruthy())
  })
})
