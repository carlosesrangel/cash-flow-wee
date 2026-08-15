import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { ReconciliationTable } from '@/components/reconciliation/reconciliation-table'

const BASE_MATCH = {
  id: 'match-1',
  status: 'nao_reconciliado' as const,
  candidate_ids: [] as string[],
  match_reason: null,
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

  it('shows each candidate\'s amount and date on its Confirmar button when match_reason has candidate details', () => {
    render(
      <ReconciliationTable
        matches={[
          {
            ...BASE_MATCH,
            status: 'conflito',
            candidate_ids: ['event-1'],
            match_reason: {
              candidatos: [
                { sumupTransactionEventId: 'event-1', valorBrutoSumupEstimado: 379.98, dataVencimentoSumup: '2026-02-02' },
              ],
            },
          },
        ]}
        canManage={true}
      />
    )
    expect(screen.getByRole('button', { name: /R\$ 379,98/ })).toBeTruthy()
  })

  it('falls back to a truncated id when match_reason has no candidate details', () => {
    render(
      <ReconciliationTable
        matches={[{ ...BASE_MATCH, status: 'conflito', candidate_ids: ['event-12345678'], match_reason: null }]}
        canManage={true}
      />
    )
    expect(screen.getByRole('button', { name: /event-12/ })).toBeTruthy()
  })

  it('labels a rejeitado_manualmente match and shows no action buttons for it', () => {
    render(<ReconciliationTable matches={[{ ...BASE_MATCH, status: 'rejeitado_manualmente' }]} canManage={true} />)
    expect(screen.getByText('Rejeitado manualmente')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
