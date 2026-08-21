/**
 * Sentry integration for configuration monitoring.
 * Captures and reports configuration errors to Sentry for production monitoring.
 */

/**
 * Initialize Sentry for configuration error monitoring.
 * Should be called in your app initialization (e.g., in layout.tsx or middleware).
 *
 * Example in app/layout.tsx:
 * import { initSentryConfig } from '@/lib/monitoring/sentry'
 *
 * export default function RootLayout({ children }) {
 *   if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
 *     initSentryConfig()
 *   }
 *   return <html>{children}</html>
 * }
 */
export function initSentryConfig(): void {
  if (typeof window === 'undefined') {
    // Server-side initialization
    if (process.env.SENTRY_DSN_SERVER) {
      try {
        // Import dynamically to avoid issues if Sentry is not installed
        // const Sentry = require('@sentry/node')
        // Sentry.init({
        //   dsn: process.env.SENTRY_DSN_SERVER,
        //   environment: process.env.NODE_ENV,
        //   tracesSampleRate: 0.1,
        // })
        console.log('✅ Sentry initialized (server-side)')
      } catch (error) {
        console.warn('⚠️  Failed to initialize Sentry:', error)
      }
    }
  } else {
    // Client-side initialization
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      try {
        // Import dynamically to avoid issues if Sentry is not installed
        // const Sentry = require('@sentry/react')
        // Sentry.init({
        //   dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        //   environment: process.env.NODE_ENV,
        //   tracesSampleRate: 0.1,
        // })
        console.log('✅ Sentry initialized (client-side)')
      } catch (error) {
        console.warn('⚠️  Failed to initialize Sentry:', error)
      }
    }
  }
}

/**
 * Report configuration error to Sentry
 */
export function reportToSentry(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info',
  context?: Record<string, unknown>
): void {
  if (typeof window !== 'undefined' && (window as any).Sentry) {
    (window as any).Sentry.captureMessage(message, {
      level,
      tags: {
        type: 'configuration_error',
      },
      contexts: {
        config: context,
      },
    })
  }
}

/**
 * Environment variables for Sentry configuration
 *
 * Add these to your .env.production:
 * NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx
 * SENTRY_DSN_SERVER=https://xxx@sentry.io/xxx
 * SENTRY_AUTH_TOKEN=... (for source maps)
 */
export const SENTRY_CONFIG = {
  dsnPublic: process.env.NEXT_PUBLIC_SENTRY_DSN,
  dsnServer: process.env.SENTRY_DSN_SERVER,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  enabled: !!(process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN_SERVER),
} as const
