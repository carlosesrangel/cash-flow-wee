'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border border-primary/20 bg-primary/10 text-primary',
        secondary: 'border border-secondary/20 bg-secondary/10 text-secondary',
        destructive: 'border border-destructive/20 bg-destructive/10 text-destructive',
        success: 'border border-green-300 bg-green-50 text-green-700 dark:border-green-600 dark:bg-green-950 dark:text-green-200',
        warning: 'border border-yellow-300 bg-yellow-50 text-yellow-700 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-200',
        outline: 'border border-border',
        realizado: 'border border-chart-1/20 bg-chart-1/10 text-chart-1',
        contratado: 'border border-chart-2/20 bg-chart-2/10 text-chart-2',
        projetado: 'border border-chart-3/20 bg-chart-3/10 text-chart-3',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
