'use client'

import type { CashFlowDay } from '@/lib/cash-flow/aggregate'
import { formatBRL } from '@/lib/format/currency'
import { formatDateOnlyBR } from '@/lib/format/date'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'

interface ChartData {
  date: string
  saldoFinal: number
  isNegative: boolean
  detalhes: {
    entradaRealizado: number
    entradaContratado: number
    entradaProjetado: number
    saidaRealizado: number
    saidaContratado: number
    saidaProjetado: number
  }
}

export function CashCurveChart({ days }: { days: CashFlowDay[] }) {
  const known = days.filter((d) => d.saldoFinal !== null) as Array<
    CashFlowDay & { saldoFinal: number }
  >

  if (known.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sem saldo confirmado ainda — registre um saldo para ver a curva.
      </p>
    )
  }

  // Transform data for recharts, preserving daily flow details for tooltip
  const chartData: ChartData[] = known.map((day) => ({
    date: day.date,
    saldoFinal: day.saldoFinal,
    isNegative: day.saldoFinal < 0,
    detalhes: {
      entradaRealizado: day.entradas.realizado,
      entradaContratado: day.entradas.contratado,
      entradaProjetado: day.entradas.projetado,
      saidaRealizado: day.saidas.realizado,
      saidaContratado: day.saidas.contratado,
      saidaProjetado: day.saidas.projetado,
    },
  }))

  // Find min/max for axis scaling
  const values = chartData.map((d) => d.saldoFinal)
  const minValue = Math.min(0, ...values)
  const maxValue = Math.max(...values)

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean
    payload?: Array<{ name: string; value: number }>
    label?: string
  }) => {
    if (!active || !payload || !label) return null

    const data = chartData.find((d) => d.date === label)
    if (!data) return null

    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
        <p className="font-heading text-xs font-semibold text-foreground">
          {formatDateOnlyBR(label)}
        </p>
        <div className="mt-2 space-y-1 text-xs">
          <div className="border-b border-border pb-2">
            <p className="font-medium text-foreground mb-1">Entradas</p>
            <div className="grid grid-cols-2 gap-2 text-muted-foreground">
              <span>Realizado: {formatBRL(data.detalhes.entradaRealizado)}</span>
              <span>Contratado: {formatBRL(data.detalhes.entradaContratado)}</span>
              <span>Projetado: {formatBRL(data.detalhes.entradaProjetado)}</span>
            </div>
          </div>
          <div className="border-b border-border py-2">
            <p className="font-medium text-foreground mb-1">Saídas</p>
            <div className="grid grid-cols-2 gap-2 text-muted-foreground">
              <span>Realizado: {formatBRL(data.detalhes.saidaRealizado)}</span>
              <span>Contratado: {formatBRL(data.detalhes.saidaContratado)}</span>
              <span>Projetado: {formatBRL(data.detalhes.saidaProjetado)}</span>
            </div>
          </div>
          <div className="pt-2">
            <div className="flex justify-between gap-4">
              <span className="font-medium text-foreground">Saldo:</span>
              <span
                className="font-mono font-semibold"
                style={{
                  color: data.isNegative ? 'var(--destructive)' : 'var(--status-positive)',
                }}
              >
                {formatBRL(data.saldoFinal)}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
        <defs>
          <linearGradient id="colorSaldo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="date"
          stroke="var(--muted-foreground)"
          tick={{ fontSize: 12 }}
          tickFormatter={(date) => formatDateOnlyBR(date).slice(0, 5)} // DD/MM
        />
        <YAxis
          stroke="var(--muted-foreground)"
          tick={{ fontSize: 12 }}
          tickFormatter={(value) => formatBRL(value).split(',')[0]} // Simplified format
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }}
          verticalAlign="bottom"
          height={36}
        />
        {/* Cumulative balance line */}
        <Line
          type="monotone"
          dataKey="saldoFinal"
          stroke="var(--chart-1)"
          strokeWidth={3}
          dot={false}
          name="Saldo Final"
          isAnimationActive={false}
        />
        {/* Reference line at zero - critical alert color */}
        <ReferenceLine
          y={0}
          stroke="var(--destructive)"
          strokeDasharray="5 5"
          strokeWidth={2}
          label={{
            value: 'Crítico (R$ 0)',
            position: 'right',
            fill: 'var(--destructive)',
            fontSize: 12,
            offset: 5,
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
