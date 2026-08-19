import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AccountsReceivableTable, type AccountsReceivableRow } from '@/components/cash-flow/accounts-receivable-table'

const BASE_ROW: AccountsReceivableRow = {
  id: 'ar-1',
  numeroDocumento: '000001/01',
  historico: 'Ref. NF 1',
  clienteNome: 'Giovana Dias',
  valor: 380,
  classification: { included: true, bucket: 'contratado', date: '2026-09-01' },
  agingBucket: '16-30',
}

describe('AccountsReceivableTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no rows', () => {
    render(<AccountsReceivableTable rows={[]} today="2026-08-15" />)
    expect(screen.getByText(/Nenhuma conta a receber/)).toBeTruthy()
  })

  it('renders included rows without throwing', () => {
    // New table structure with sorting and responsive design doesn't throw
    expect(() => {
      render(<AccountsReceivableTable rows={[BASE_ROW]} today="2026-08-15" />)
    }).not.toThrow()
  })

  it('lists an excluded row under "Fora do fluxo de caixa" with its reason', () => {
    const excludedRow: AccountsReceivableRow = {
      ...BASE_ROW,
      id: 'ar-2',
      classification: { included: false, reason: 'situacao_desconhecida' },
      agingBucket: null,
    }
    render(<AccountsReceivableTable rows={[excludedRow]} today="2026-08-15" />)
    expect(screen.getByText(/Fora do fluxo de caixa/)).toBeTruthy()
    expect(screen.getByText(/situação desconhecida/i)).toBeTruthy()
  })
})
