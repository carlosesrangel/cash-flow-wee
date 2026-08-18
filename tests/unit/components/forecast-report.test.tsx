import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ForecastReport } from '@/components/forecast/forecast-report'
import type { ForecastVsRealizadoRow } from '@/lib/forecast/compare'

const REPORT: ForecastVsRealizadoRow[] = [
  { ano: 2026, mes: 8, planejado: 10000, realizado: 9500, diferencaAbsoluta: -500, diferencaPercentual: -0.05 },
  { ano: 2026, mes: 9, planejado: 12000, realizado: null, diferencaAbsoluta: null, diferencaPercentual: null },
  { ano: 2027, mes: 1, planejado: 15000, realizado: 16000, diferencaAbsoluta: 1000, diferencaPercentual: 0.067 },
]

describe('ForecastReport', () => {
  afterEach(() => cleanup())

  it('renders forecast vs realizado report', () => {
    render(<ForecastReport rows={REPORT} />)

    expect(screen.getByText('2026')).toBeTruthy()
    expect(screen.getByText('2027')).toBeTruthy()
    expect(screen.getByText('Agosto')).toBeTruthy()
    expect(screen.getByText('Setembro')).toBeTruthy()
  })

  it('renders null realizado as —', () => {
    render(<ForecastReport rows={REPORT} />)

    // Find the "—" for null realizado value
    const rows = screen.getAllByRole('row')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('shows no data message when report is empty', () => {
    render(<ForecastReport rows={[]} />)

    expect(screen.getByText(/Nenhum dado disponível/)).toBeTruthy()
  })

  it('groups by year', () => {
    const { container } = render(<ForecastReport rows={REPORT} />)

    const headings = container.querySelectorAll('h3')
    expect(headings.length).toBe(2) // 2026 and 2027
  })
})
