import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { OlistCard } from '@/components/integrations/olist-card'

describe('OlistCard', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the Conectar button when the member can manage integrations and is disconnected', () => {
    render(<OlistCard status="desconectado" connectedAt={null} canManage />)

    expect(screen.getByRole('link', { name: 'Conectar' })).toBeTruthy()
    expect(screen.queryByText('Apenas administradores podem gerenciar esta integração.')).toBeNull()
  })

  it('renders the Sincronizar agora button when the member can manage integrations and is connected', () => {
    render(<OlistCard status="conectado" connectedAt="2026-01-01T00:00:00Z" canManage />)

    expect(screen.getByRole('button', { name: 'Sincronizar agora' })).toBeTruthy()
  })

  it('hides Connect/Sync buttons and shows a note when the member cannot manage integrations', () => {
    render(<OlistCard status="desconectado" connectedAt={null} canManage={false} />)

    expect(screen.queryByRole('link', { name: 'Conectar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sincronizar agora' })).toBeNull()
    expect(screen.getByText('Apenas administradores podem gerenciar esta integração.')).toBeTruthy()
  })

  it('hides the Sincronizar agora button when connected but the member cannot manage integrations', () => {
    render(<OlistCard status="conectado" connectedAt="2026-01-01T00:00:00Z" canManage={false} />)

    expect(screen.queryByRole('button', { name: 'Sincronizar agora' })).toBeNull()
    expect(screen.getByText('Apenas administradores podem gerenciar esta integração.')).toBeTruthy()
  })
})
