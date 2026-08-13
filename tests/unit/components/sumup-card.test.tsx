import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { SumupCard } from '@/components/integrations/sumup-card'

describe('SumupCard', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows the sync button when canManage is true and status is configurado', () => {
    render(<SumupCard status="configurado" canManage={true} />)
    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).toBeTruthy()
  })

  it('disables the sync button when status is erro_configuracao', () => {
    render(<SumupCard status="erro_configuracao" canManage={true} />)
    expect(
      (screen.getByRole('button', { name: 'Sincronizar agora' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('hides the sync button entirely when canManage is false', () => {
    render(<SumupCard status="configurado" canManage={false} />)
    expect(screen.queryByRole('button', { name: 'Sincronizar agora' })).toBeNull()
    expect(screen.getByText(/Apenas administradores/)).toBeTruthy()
  })
})
