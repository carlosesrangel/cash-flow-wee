import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { ReconciliationTable } from '@/components/reconciliation/reconciliation-table'

const BASE_MATCH = {
  id: 'match-1',
  status: 'nao_reconciliado' as const,
  candidate_ids: [] as string[],
  olist_accounts_receivable: {
    historico: 'Ref. a NF nº 516, Giovana Dias (parcela 3/3)',
    numero_documento: '000516/03',
    valor: 380,
    data_vencimento: '2026-02-01',
  },
}

describe('ReconciliationTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no matches', () => {
    render(<ReconciliationTable matches={[]} canManage={true} />)
    expect(screen.getByText(/Nenhuma parcela/)).toBeTruthy()
  })

  it('renders a row per match with its formatted value', () => {
    render(<ReconciliationTable matches={[BASE_MATCH]} canManage={true} />)
    expect(screen.getByText('000516/03')).toBeTruthy()
    expect(screen.getByText('R$ 380,00')).toBeTruthy()
  })

  it('shows one confirm button per candidate when status is conflito and canManage is true', () => {
    render(
      <ReconciliationTable
        matches={[{ ...BASE_MATCH, status: 'conflito', candidate_ids: ['event-1', 'event-2'] }]}
        canManage={true}
      />
    )
    expect(screen.getAllByRole('button', { name: /Confirmar/ })).toHaveLength(2)
  })

  it('shows an undo button when status is reconciliado_automaticamente and canManage is true', () => {
    render(<ReconciliationTable matches={[{ ...BASE_MATCH, status: 'reconciliado_automaticamente' }]} canManage={true} />)
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeTruthy()
  })

  it('hides every action when canManage is false', () => {
    render(
      <ReconciliationTable
        matches={[{ ...BASE_MATCH, status: 'conflito', candidate_ids: ['event-1'] }]}
        canManage={false}
      />
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})
