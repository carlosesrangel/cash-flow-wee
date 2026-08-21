# Production Monitoring Setup

This guide explains how to set up production monitoring for configuration errors and runtime issues.

## Overview

The application includes built-in monitoring for:
- Configuration errors (missing or invalid environment variables)
- Application health status
- Error logging and tracking

## Health Check Endpoint

### Configuration Health Check

**Endpoint:** `GET /api/health/config`

**Purpose:** Verify environment configuration status in production

**Response:**
```json
{
  "healthy": true,
  "configHealth": {
    "isHealthy": true,
    "issues": []
  },
  "status": {
    "errorCount": 0,
    "criticalCount": 0,
    "lastError": null
  },
  "timestamp": "2024-08-21T10:30:45.123Z"
}
```

**Status Codes:**
- `200` - Configuration is healthy
- `503` - Configuration issues detected (unhealthy)

### Monitoring the Health Check

Add this to your monitoring service (Datadog, New Relic, etc.):

```bash
# Check every 5 minutes
*/5 * * * * curl -f https://your-domain.com/api/health/config || alert "Config health check failed"
```

### Response Headers

- `X-Config-Health` - Overall health status (healthy/warning/unhealthy)
- `X-Config-Error` - Name of the problematic variable (if any)
- `Cache-Control` - no-cache (fresh status on every request)

## Error Monitoring with Sentry

### Setup

1. **Create a Sentry account** (free tier available)
   - Go to [sentry.io](https://sentry.io)
   - Create a new organization and project
   - Choose "Next.js" as the platform

2. **Get your Sentry DSN**
   - Copy the public DSN (starts with https://)
   - Copy the server DSN (if provided)

3. **Add environment variables:**

   **For Vercel:**
   ```
   Settings → Environment Variables
   
   NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx (client-side)
   SENTRY_DSN_SERVER=https://xxx@sentry.io/xxx (server-side)
   SENTRY_AUTH_TOKEN=sntrys_xxx (for source maps)
   ```

   **For .env.production:**
   ```bash
   NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx
   SENTRY_DSN_SERVER=https://xxx@sentry.io/xxx
   SENTRY_AUTH_TOKEN=sntrys_xxx
   ```

4. **Initialize in your app:**

   In `app/layout.tsx`:
   ```typescript
   import { initSentryConfig } from '@/lib/monitoring/sentry'

   export default function RootLayout({ children }) {
     if (process.env.NODE_ENV === 'production') {
       initSentryConfig()
     }

     return (
       <html>
         <body>{children}</body>
       </html>
     )
   }
   ```

### Configuration Errors in Sentry

When configuration errors occur, they're automatically reported to Sentry with:

- **Error Type:** Configuration Error
- **Severity:** Critical/Warning/Info
- **Tags:** 
  - `type: config_error`
  - `variable: [VARIABLE_NAME]`
  - `severity: [critical|warning|info]`
- **Context:**
  - Configuration value (truncated for security)
  - Error message
  - Stack trace

### Viewing Errors in Sentry

1. Go to [sentry.io](https://sentry.io) → Your Project
2. Click "Issues" → Filter by tag `type:config_error`
3. Click an issue to see:
   - When it occurred (timeline)
   - Which environment
   - Value that was problematic
   - Stack trace for debugging

### Alerts in Sentry

Create alerts for critical configuration errors:

1. Go to **Alerts** → **New Alert Rule**
2. Set condition: `error.level: error AND tags.type: config_error`
3. Set action: Notify via Slack, email, or PagerDuty

Example alert:
```
Alert: Configuration error detected
- Variable: NEXT_PUBLIC_SUPABASE_URL
- Message: Missing required environment variable
- Environment: production
- Time: 2024-08-21 10:30:45 UTC
```

## Monitoring Configuration

### Custom Monitoring Endpoint

Set up your own monitoring:

```bash
# Add to environment
NEXT_PUBLIC_MONITORING_ENDPOINT=https://monitoring.example.com/config-errors
```

Configuration errors will POST to:
```
POST /config-errors
Content-Type: application/json

{
  "type": "config_error",
  "error": {
    "timestamp": "2024-08-21T10:30:45.123Z",
    "severity": "critical",
    "variable": "NEXT_PUBLIC_SUPABASE_URL",
    "message": "Missing required environment variable",
    "context": { /* error context */ }
  },
  "url": "https://your-domain.com/dashboard",
  "userAgent": "Mozilla/5.0..."
}
```

## Datadog Integration

### Setup

1. Install Datadog agent on your deployment
2. Add to `next.config.ts`:

```typescript
import { reportConfigError } from '@/lib/monitoring/config-errors'

// At application start
if (process.env.DD_TRACE_ENABLED) {
  const tracer = require('dd-trace').init()
}
```

3. Configuration errors will appear in Datadog Logs with tags:
   - `type: config_error`
   - `severity: critical|warning|info`
   - `variable: [VARIABLE_NAME]`

### Query Examples

Find all configuration errors:
```
type: config_error
```

Find critical errors in last 24 hours:
```
type: config_error AND severity: critical AND @timestamp: [now - 24h TO now]
```

Find errors for specific variable:
```
type: config_error AND variable: NEXT_PUBLIC_SUPABASE_URL
```

## New Relic Integration

### Setup

1. Go to New Relic → Add data → Logs
2. Follow the Next.js integration guide
3. Configuration errors will be captured automatically

### Monitoring Dashboard

Create a dashboard in New Relic:

```nrql
SELECT count(*) FROM Log WHERE message LIKE '%CRITICAL CONFIG ERROR%' FACET variable SINCE 24 hours ago
```

## GitHub Actions Monitoring

The CI/CD workflow already validates configuration, but you can enhance it:

```yaml
- name: Report configuration status to monitoring
  run: npm run check:env && echo "✅ Configuration validated"
  env:
    # Set all required environment variables from secrets

- name: Send health check to monitoring endpoint
  if: always()
  run: |
    curl -X POST https://monitoring.example.com/ci-config-check \
      -H "Content-Type: application/json" \
      -d "{\"status\": \"${{ job.status }}\", \"job\": \"${{ github.job }}\"}"
```

## Production Checklist

Before deploying to production:

- [ ] All required environment variables are set
- [ ] `npm run check:env` passes locally
- [ ] Sentry DSN is configured (if using Sentry)
- [ ] Monitoring endpoint is set up and accessible
- [ ] Health check endpoint is accessible (`/api/health/config`)
- [ ] CI/CD pipeline validates configuration
- [ ] Team has access to monitoring dashboard
- [ ] Alerts are configured for critical errors
- [ ] Runbook is documented for common issues

## Troubleshooting

### "Failed to connect to monitoring endpoint"

Configuration errors failed to report but application continued:
- Check that your monitoring endpoint is accessible
- Verify HTTPS is working
- Check firewall rules
- (This is intentional - monitoring failures don't break the app)

### "Configuration health check returns 503"

Indicates configuration is missing/invalid:
```bash
# Run locally to debug
npm run check:env

# Check specific variable
echo $NEXT_PUBLIC_SUPABASE_URL
```

### "Sentry is reporting too many errors"

Adjust Sentry configuration:
```typescript
// In sentry.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  ignoreErrors: [
    // Ignore known harmless errors
    'Non-Error promise rejection captured',
  ],
})
```

### "Can't see configuration errors in Sentry"

1. Verify DSN is correct: `echo $NEXT_PUBLIC_SENTRY_DSN`
2. Check browser console for Sentry errors
3. Verify Sentry project is active in dashboard
4. Try trigger error manually:
   ```typescript
   import { reportToSentry } from '@/lib/monitoring/sentry'
   reportToSentry('Test error', 'error', { test: true })
   ```

## Performance Impact

Configuration monitoring has minimal performance impact:

- **Health check endpoint:** <1ms (local checks)
- **Error logging:** <5ms per error (async)
- **Sentry reporting:** Async (non-blocking)
- **Memory overhead:** ~1KB per 100 errors (auto-purged after 100)

## Support

For monitoring setup help:
- 📖 Check this guide first
- 🚨 Test with `/api/health/config`
- 📊 Review monitoring dashboard
- 💬 Check Sentry/Datadog documentation
- 🐛 Open GitHub issue with monitoring logs
