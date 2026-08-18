import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DailyTable } from '@/components/cash-flow/daily-table'
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'
import type { CashFlowEntry } from '@/lib/cash-flow/engine'

const DAYS: CashFlowDay[] = [
  {
    date: '2026-08-15',
    saldoInicial: 1000,
    entradas: { realizado: 100, contratado: 0, projetado: 0 },
    saidas: { realizado: 0, contratado: 0, projetado: 0 },
    saldoFinal: 1100,
  },
]

const ENTRIES: CashFlowEntry[] = [
  {
    id: 'manual-1',
    origin: 'manual',
    sourceId: '1',
    date: '2026-08-15',
    amount: 100,
    direction: 'entrada',
    bucket: 'realizado',
    description: 'Venda avulsa',
  },
]

describe('DailyTable', () => {
  afterEach(() => cleanup())

  it('shows a message when there are no days', () => {
    render(<DailyTable days={[]} entries={[]} />)
    expect(screen.getByText(/Nenhum dado/)).toBeTruthy()
  })

  it('renders a row per day with formatted saldo inicial and final', () => {
    render(<DailyTable days={DAYS} entries={ENTRIES} />)
    expect(screen.getByText('R$ 1.000,00')).toBeTruthy()
    expect(screen.getByText('R$ 1.100,00')).toBeTruthy()
  })

  it('expands a day to show its underlying entries on click', () => {
    render(<DailyTable days={DAYS} entries={ENTRIES} />)
    expect(screen.queryByText('Venda avulsa')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /15\/08\/2026/ }))
    expect(screen.getByText('Venda avulsa')).toBeTruthy()
  })
})
