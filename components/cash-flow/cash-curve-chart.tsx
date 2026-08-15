import type { CashFlowDay } from '@/lib/cash-flow/aggregate'

const WIDTH = 640
const HEIGHT = 160
const PADDING = 24

// Visual tokens per the `dataviz` skill's reference palette (references/palette.md):
// a single series needs no legend/hue distinction, so the curve uses primary ink;
// the zero-threshold line and any below-zero marker use the fixed status "critical"
// color (never reused for a plain series), paired with the alert text block that
// already sits beside this chart on the page (status color is never carried by
// hue alone). Markers get a surface-color ring per the marker spec so they stay
// legible where they cross the line.
const INK = '#0b0b0b'
const CRITICAL = '#d03b3b'
const SURFACE = '#fcfcfb'

export function CashCurveChart({ days }: { days: CashFlowDay[] }) {
  const known = days.filter((d) => d.saldoFinal !== null) as Array<CashFlowDay & { saldoFinal: number }>

  if (known.length === 0) {
    return <p className="text-sm text-neutral-500">Sem saldo confirmado ainda — registre um saldo para ver a curva.</p>
  }

  const values = known.map((d) => d.saldoFinal)
  const min = Math.min(0, ...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const points = known.map((day, index) => {
    const x = PADDING + (index / Math.max(1, known.length - 1)) * (WIDTH - PADDING * 2)
    const y = HEIGHT - PADDING - ((day.saldoFinal - min) / range) * (HEIGHT - PADDING * 2)
    return { x, y, day }
  })

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const zeroY = HEIGHT - PADDING - ((0 - min) / range) * (HEIGHT - PADDING * 2)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Curva de caixa" className="w-full">
      {min < 0 && (
        <line x1={PADDING} y1={zeroY} x2={WIDTH - PADDING} y2={zeroY} stroke={CRITICAL} strokeWidth={1} strokeDasharray="4 4" />
      )}
      <path d={path} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p) => (
        <circle
          key={p.day.date}
          cx={p.x}
          cy={p.y}
          r={4}
          fill={p.day.saldoFinal < 0 ? CRITICAL : INK}
          stroke={SURFACE}
          strokeWidth={2}
        />
      ))}
    </svg>
  )
}
