import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ScenarioMultipliersGrid } from '@/components/forecast/scenario-multipliers-grid'

const SCENARIO = { id: 'scenario-1', name: 'Conservador', createdAt: '2026-08-16T00:00:00Z' }

const MULTIPLIERS = [
  { ano: 2026, mes: 1, value: 0.9 },
  { ano: 2026, mes: 2, value: 0.9 },
]

describe('ScenarioMultipliersGrid', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders scenario name', () => {
    render(<ScenarioMultipliersGrid scenario={SCENARIO} multipliers={MULTIPLIERS} canEdit={false} />)

    expect(screen.getByText('Conservador')).toBeTruthy()
  })

  it('shows no multipliers message when list is empty', () => {
    render(<ScenarioMultipliersGrid scenario={SCENARIO} multipliers={[]} canEdit={false} />)

    expect(screen.getByText(/Nenhum multiplicador configurado/)).toBeTruthy()
  })

  it('posts to /api/forecast/cenarios/multiplicadores when editing a multiplier', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<ScenarioMultipliersGrid scenario={SCENARIO} multipliers={MULTIPLIERS} canEdit={true} />)

    const input = container.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '85' } })
    fireEvent.blur(input)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/forecast/cenarios/multiplicadores',
      expect.objectContaining({ method: 'POST' })
    ))
  })
})
