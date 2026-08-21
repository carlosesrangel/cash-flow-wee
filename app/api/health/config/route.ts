/**
 * Configuration health check endpoint.
 * Provides diagnostics about environment configuration status.
 * Useful for monitoring and debugging configuration issues in production.
 */

import { NextResponse } from 'next/server'
import { handleConfigurationHealthCheck } from '@/lib/monitoring/config-middleware'

/**
 * GET /api/health/config
 *
 * Returns configuration health status.
 * This endpoint is public and can be used by monitoring services.
 *
 * Response:
 * {
 *   healthy: boolean,
 *   configHealth: {
 *     isHealthy: boolean,
 *     issues: string[]
 *   },
 *   status: {
 *     errorCount: number,
 *     criticalCount: number,
 *     lastError?: ConfigError
 *   },
 *   timestamp: string
 * }
 *
 * Status codes:
 * - 200: Configuration is healthy
 * - 503: Configuration issues detected
 */
export async function GET() {
  return handleConfigurationHealthCheck()
}
