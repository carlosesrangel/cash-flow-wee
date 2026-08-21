/**
 * Configuration error monitoring and logging.
 * Captures and reports environment configuration issues in production.
 */

export interface ConfigError {
  timestamp: string
  severity: 'critical' | 'warning' | 'info'
  variable: string
  message: string
  context?: Record<string, unknown>
  stackTrace?: string
}

// Store recent config errors for debugging
const configErrorLog: ConfigError[] = []
const MAX_ERROR_LOG_SIZE = 100

/**
 * Report a configuration error
 */
export function reportConfigError(
  variable: string,
  message: string,
  severity: 'critical' | 'warning' | 'info' = 'warning',
  context?: Record<string, unknown>,
) {
  const error: ConfigError = {
    timestamp: new Date().toISOString(),
    severity,
    variable,
    message,
    context,
    stackTrace: new Error().stack?.split('\n').slice(1, 5).join('\n'),
  }

  // Add to log
  configErrorLog.push(error)
  if (configErrorLog.length > MAX_ERROR_LOG_SIZE) {
    configErrorLog.shift()
  }

  // Log based on severity
  if (severity === 'critical') {
    console.error(`🚨 CRITICAL CONFIG ERROR [${variable}]: ${message}`, context)
    // In production, you might send to external monitoring service
    sendToMonitoring(error)
  } else if (severity === 'warning') {
    console.warn(`⚠️  CONFIG WARNING [${variable}]: ${message}`, context)
  } else {
    console.info(`ℹ️  CONFIG INFO [${variable}]: ${message}`)
  }
}

/**
 * Get all recorded configuration errors
 */
export function getConfigErrorLog(): ConfigError[] {
  return [...configErrorLog]
}

/**
 * Check if a configuration error is critical and blocking
 */
export function isCriticalConfigError(variable: string): boolean {
  return configErrorLog.some(
    (err) => err.variable === variable && err.severity === 'critical'
  )
}

/**
 * Clear the error log
 */
export function clearConfigErrorLog(): void {
  configErrorLog.length = 0
}

/**
 * Get configuration health status
 */
export function getConfigHealthStatus(): {
  isHealthy: boolean
  errorCount: number
  criticalCount: number
  lastError?: ConfigError
} {
  const criticalErrors = configErrorLog.filter((err) => err.severity === 'critical')
  const lastError = configErrorLog[configErrorLog.length - 1]

  return {
    isHealthy: criticalErrors.length === 0,
    errorCount: configErrorLog.length,
    criticalCount: criticalErrors.length,
    lastError,
  }
}

/**
 * Send error to external monitoring service
 * Implement this based on your monitoring provider (Sentry, DataDog, etc.)
 */
function sendToMonitoring(error: ConfigError): void {
  // Example: Send to Sentry
  if (typeof window !== 'undefined' && (window as any).Sentry) {
    (window as any).Sentry.captureMessage(`Configuration Error: ${error.variable}`, {
      level: 'error',
      tags: {
        type: 'config_error',
        variable: error.variable,
        severity: error.severity,
      },
      contexts: {
        config: error.context,
      },
    })
  }

  // Example: Send to custom monitoring endpoint
  if (process.env.NEXT_PUBLIC_MONITORING_ENDPOINT) {
    fetch(process.env.NEXT_PUBLIC_MONITORING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'config_error',
        error: error,
        url: typeof window !== 'undefined' ? window.location.href : 'server',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      }),
    }).catch(() => {
      // Silently fail if monitoring endpoint is unavailable
    })
  }
}

/**
 * Monitor specific configuration variable
 */
export class ConfigMonitor {
  private variable: string
  private lastValue?: string

  constructor(variable: string) {
    this.variable = variable
    this.lastValue = process.env[variable]
  }

  /**
   * Check if configuration has changed (and possibly become invalid)
   */
  hasChanged(): boolean {
    const currentValue = process.env[this.variable]
    return currentValue !== this.lastValue
  }

  /**
   * Get configuration change history
   */
  getHistory(): { timestamp: string; value?: string }[] {
    return configErrorLog
      .filter((err) => err.variable === this.variable)
      .map((err) => ({
        timestamp: err.timestamp,
        value: err.context?.value as string | undefined,
      }))
  }

  /**
   * Validate current value
   */
  validate(validator: (value: string | undefined) => boolean): boolean {
    const currentValue = process.env[this.variable]
    const isValid = validator(currentValue)

    if (!isValid) {
      reportConfigError(
        this.variable,
        `Validation failed for ${this.variable}`,
        'warning',
        {
          value: currentValue ? currentValue.substring(0, 20) + '...' : undefined,
          expected: 'Valid value',
        }
      )
    }

    return isValid
  }
}

/**
 * Create a configuration monitor for a variable
 */
export function monitorConfig(variable: string): ConfigMonitor {
  return new ConfigMonitor(variable)
}
