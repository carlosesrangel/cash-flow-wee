import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccountsPayableTable, type AccountsPayableRow } from '@/components/cash-flow/accounts-payable-table'

const BASE_ROW: AccountsPayableRow = {
  id: 'ap-1',
  numeroDocumento: 'F-100',
  historico: 'Frete',
  fornecedorNome: 'Transportadora XPTO',
  valor: 500,
  classification: { included: true, bucket: 'contratado', date: '2026-09-01' },
  agingBucket: '16-30',
}

describe('AccountsPayableTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no rows', () => {
    render(<AccountsPayableTable rows={[]} today="2026-08-15" />)
    expect(screen.getByText(/Nenhuma conta a pagar/)).toBeTruthy()
  })

  it('renders an included row with its formatted value and aging label', () => {
    render(<AccountsPayableTable rows={[BASE_ROW]} today="2026-08-15" />)
    expect(screen.getByText('F-100')).toBeTruthy()
    expect(screen.getByText('R$ 500,00')).toBeTruthy()
    expect(screen.getByText('16 a 30 dias')).toBeTruthy()
  })

  it('lists an excluded row under "Fora do fluxo de caixa" with its reason', () => {
    const excludedRow: AccountsPayableRow = {
      ...BASE_ROW,
      id: 'ap-2',
      classification: { included: false, reason: 'cancelado' },
      agingBucket: null,
    }
    render(<AccountsPayableTable rows={[excludedRow]} today="2026-08-15" />)
    expect(screen.getByText(/Fora do fluxo de caixa/)).toBeTruthy()
    expect(screen.getByText(/cancelado/)).toBeTruthy()
  })
})
