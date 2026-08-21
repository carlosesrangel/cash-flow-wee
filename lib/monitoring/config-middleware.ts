/**
 * Middleware for monitoring configuration errors in API routes.
 * Captures and logs configuration-related issues for debugging.
 */

import { NextRequest, NextResponse } from 'next/server'
import { reportConfigError, getConfigHealthStatus } from './config-errors'

/**
 * Check for common configuration errors
 */
export function checkConfigurationHealth(): { isHealthy: boolean; issues: string[] } {
  const issues: string[] = []

  // Check Supabase configuration
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    issues.push('NEXT_PUBLIC_SUPABASE_URL is not set')
    reportConfigError('NEXT_PUBLIC_SUPABASE_URL', 'Missing Supabase URL', 'critical')
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    issues.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
    reportConfigError('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Missing Supabase anon key', 'critical')
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    issues.push('SUPABASE_SERVICE_ROLE_KEY is not set')
    reportConfigError('SUPABASE_SERVICE_ROLE_KEY', 'Missing Supabase service role key', 'critical')
  }

  // Check Supabase URL format
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (url && !url.startsWith('https://') && !url.startsWith('http://127.0.0.1')) {
    issues.push('NEXT_PUBLIC_SUPABASE_URL must be HTTPS')
    reportConfigError('NEXT_PUBLIC_SUPABASE_URL', 'Invalid Supabase URL format', 'warning', {
      url: url.substring(0, 30) + '...',
    })
  }

  return {
    isHealthy: issues.length === 0,
    issues,
  }
}

/**
 * API route wrapper that monitors configuration
 */
export function withConfigurationMonitoring<T extends (...args: any[]) => Promise<NextResponse>>(
  handler: T
): T {
  return (async (...args: any[]) => {
    const configStatus = getConfigHealthStatus()

    if (!configStatus.isHealthy) {
      console.warn('⚠️  Configuration health check failed', {
        criticalErrors: configStatus.criticalCount,
      })

      // Return warning header in response (for debugging)
      const response = await handler(...args)
      response.headers.set('X-Config-Health', 'warning')
      if (configStatus.lastError) {
        response.headers.set('X-Config-Error', configStatus.lastError.variable)
      }
      return response
    }

    return handler(...args)
  }) as T
}

/**
 * Health check endpoint for configuration
 */
export async function handleConfigurationHealthCheck(): Promise<NextResponse> {
  const health = checkConfigurationHealth()
  const status = getConfigHealthStatus()

  return NextResponse.json(
    {
      healthy: health.isHealthy && status.isHealthy,
      configHealth: health,
      status: {
        errorCount: status.errorCount,
        criticalCount: status.criticalCount,
        lastError: status.lastError,
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: health.isHealthy && status.isHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Config-Health': health.isHealthy ? 'healthy' : 'unhealthy',
      },
    }
  )
}

/**
 * Log configuration errors that occur during request handling
 */
export function captureConfigurationError(
  error: unknown,
  variable: string,
  context?: Record<string, unknown>
): void {
  let message = 'Unknown error'

  if (error instanceof Error) {
    message = error.message
  } else if (typeof error === 'string') {
    message = error
  }

  reportConfigError(variable, message, 'critical', {
    ...context,
    errorType: error instanceof Error ? error.constructor.name : typeof error,
  })
}
