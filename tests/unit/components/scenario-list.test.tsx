import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ScenarioList } from '@/components/forecast/scenario-list'

const SCENARIOS = [
  { id: '1', name: 'Base', createdAt: '2026-08-16T00:00:00Z' },
  { id: '2', name: 'Conservador', createdAt: '2026-08-16T00:00:00Z' },
]

describe('ScenarioList', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders scenarios', () => {
    render(<ScenarioList scenarios={SCENARIOS} canCreate={false} onSelect={vi.fn()} />)

    expect(screen.getByText('Base')).toBeTruthy()
    expect(screen.getByText('Conservador')).toBeTruthy()
  })

  it('does not show create button when canCreate is false', () => {
    render(<ScenarioList scenarios={SCENARIOS} canCreate={false} onSelect={vi.fn()} />)

    expect(screen.queryByText('Novo Cenário')).toBeNull()
  })

  it('shows create button when canCreate is true', () => {
    render(<ScenarioList scenarios={SCENARIOS} canCreate={true} onSelect={vi.fn()} />)

    expect(screen.getByText('Novo Cenário')).toBeTruthy()
  })

  it('posts to /api/forecast/cenarios when creating a scenario', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'new-id' }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<ScenarioList scenarios={SCENARIOS} canCreate={true} onSelect={vi.fn()} />)

    fireEvent.click(screen.getByText('Novo Cenário'))
    fireEvent.change(screen.getByPlaceholderText('Nome do cenário'), { target: { value: 'Otimista' } })
    fireEvent.click(screen.getByText('Criar'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/forecast/cenarios',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Otimista' }) })
    ))
  })

  it('shows error when trying to create scenario without name', async () => {
    render(<ScenarioList scenarios={SCENARIOS} canCreate={true} onSelect={vi.fn()} />)

    fireEvent.click(screen.getByText('Novo Cenário'))
    fireEvent.click(screen.getByText('Criar'))

    await waitFor(() => expect(screen.getByText('Nome do cenário é obrigatório')).toBeTruthy())
  })
})
