'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  phase?: string
}

function EmptyState({
  className,
  icon,
  title,
  description,
  action,
  phase,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center',
        className,
      )}
      {...props}
    >
      {icon && <div className="text-4xl">{icon}</div>}
      <div>
        <h3 className="font-heading text-lg font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
        {phase && (
          <p className="mt-2 text-xs text-muted-foreground">Em construção — chega na {phase}.</p>
        )}
      </div>
      {action && (
        <Button onClick={action.onClick} variant="default">
          {action.label}
        </Button>
      )}
    </div>
  )
}

export { EmptyState }
