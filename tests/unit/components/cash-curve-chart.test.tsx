import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CashCurveChart } from '@/components/cash-flow/cash-curve-chart'
import type { CashFlowDay } from '@/lib/cash-flow/aggregate'

const DAYS: CashFlowDay[] = [
  { date: '2026-08-15', saldoInicial: 1000, entradas: { realizado: 0, contratado: 0, projetado: 0 }, saidas: { realizado: 0, contratado: 0, projetado: 0 }, saldoFinal: 1000 },
  { date: '2026-08-16', saldoInicial: 1000, entradas: { realizado: 200, contratado: 0, projetado: 0 }, saidas: { realizado: 0, contratado: 0, projetado: 0 }, saldoFinal: 1200 },
]

describe('CashCurveChart', () => {
  afterEach(() => cleanup())

  it('shows a message when there is no day with a known saldoFinal', () => {
    render(<CashCurveChart days={[{ ...DAYS[0], saldoInicial: null, saldoFinal: null }]} />)
    expect(screen.getByText(/Sem saldo confirmado/)).toBeTruthy()
  })

  it('renders a chart when saldoFinal is known without throwing', () => {
    // recharts ResponsiveContainer requires a parent with dimensions in a real browser
    // In tests, we just verify it doesn't throw an error
    expect(() => {
      render(
        <div style={{ width: '800px', height: '400px' }}>
          <CashCurveChart days={DAYS} />
        </div>
      )
    }).not.toThrow()
  })
})
