import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AnnualTable } from '@/components/cash-flow/annual-table'
import type { CashFlowMonth } from '@/lib/cash-flow/aggregate'

const MONTHS: CashFlowMonth[] = [
  {
    month: '2026-08',
    entradas: { realizado: 1000, contratado: 500 },
    saidas: { realizado: 300, contratado: 200 },
    saldoFinal: 5000,
  },
]

describe('AnnualTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no months', () => {
    render(<AnnualTable months={[]} />)
    expect(screen.getByText(/Nenhum dado/)).toBeTruthy()
  })

  it('renders a row per month with entradas, saidas, resultado and saldo final totals', () => {
    render(<AnnualTable months={MONTHS} />)
    expect(screen.getByText('R$ 1.500,00')).toBeTruthy() // entradas total
    expect(screen.getByText('R$ 500,00')).toBeTruthy() // saidas total
    expect(screen.getByText('R$ 1.000,00')).toBeTruthy() // resultado (1500 - 500)
    expect(screen.getByText('R$ 5.000,00')).toBeTruthy() // saldo final
  })
})
