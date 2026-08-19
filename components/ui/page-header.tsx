'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

const PageHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    title: string
    subtitle?: string
    description?: string
    action?: React.ReactNode
  }
>(({ className, title, subtitle, description, action, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between', className)}
    {...props}
  >
    <div className="flex-1">
      <h1 className="font-heading text-3xl font-light tracking-tight text-foreground">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {subtitle}
        </p>
      )}
      {description && (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
    {action && <div className="mt-4 sm:mt-0 sm:ml-4">{action}</div>}
  </div>
))
PageHeader.displayName = 'PageHeader'

export { PageHeader }
