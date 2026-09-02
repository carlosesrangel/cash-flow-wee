import * as React from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from './card'

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string
  value: string | React.ReactNode
  accentColor?: 'navy' | 'green' | 'red' | 'brown'
  footnote?: string | React.ReactNode
  icon?: React.ReactNode
}

const accentColorMap = {
  navy: '#082d74',
  green: '#1c6e3c',
  red: '#c2341e',
  brown: '#846340',
}

function MetricCard({
  className,
  label,
  value,
  accentColor = 'navy',
  footnote,
  icon,
  ...props
}: MetricCardProps) {
  const color = accentColorMap[accentColor]

  return (
    <Card className={cn('', className)} {...props}>
      <CardContent className="flex min-h-[132px] items-start justify-between p-5">
        <div className="flex-1">
          <p className="font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            {label}
          </p>
          <p
            className="font-heading text-4xl font-light tabular-nums leading-tight mb-2"
            style={{ color }}
          >
            {value}
          </p>
          {footnote && (
            <p className="text-xs text-muted-foreground">{footnote}</p>
          )}
        </div>
        {icon && (
          <div className="ml-4 flex-shrink-0">
            {icon}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export { MetricCard }
