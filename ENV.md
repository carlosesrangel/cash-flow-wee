# Environment Configuration Guide

This document describes all environment variables required for the Cash Flow WEE application.

## Quick Start

Copy `.env.example` to `.env.local` and fill in the required values:

```bash
cp .env.example .env.local
```

Then verify your configuration:

```bash
npm run check:env
```

## Required Variables

### Supabase (Database & Auth)

These variables are **required** for the application to run.

- **NEXT_PUBLIC_SUPABASE_URL**
  - Description: Your Supabase project URL
  - Example: `https://your-project.supabase.co`
  - Type: Public (browser-safe)
  - Scope: Frontend + Backend

- **NEXT_PUBLIC_SUPABASE_ANON_KEY**
  - Description: Supabase anonymous public key
  - Type: Public (browser-safe)
  - Scope: Frontend + Backend
  - ⚠️ This key is safe to expose in browser requests (it's public-facing only)

- **SUPABASE_SERVICE_ROLE_KEY**
  - Description: Supabase service role key (full database access)
  - Type: Secret (server-only)
  - Scope: Backend only
  - 🔒 **CRITICAL:** Never expose this in browser or public repositories

## Optional Variables

These variables enable specific features. The application will work without them but with reduced functionality.

### Olist Integration

Enable marketplace data synchronization from Olist.

- **OLIST_CLIENT_ID**
  - Description: Olist OAuth client ID
  - Get from: [Olist Developer Portal](https://hub.olist.com)
  - Required for: Marketplace order sync, payment reconciliation

- **OLIST_CLIENT_SECRET**
  - Description: Olist OAuth client secret
  - Type: Secret
  - Required for: OAuth authentication flow

- **OLIST_REDIRECT_URI**
  - Description: OAuth redirect URI for Olist callback
  - Example: `http://localhost:3000/integracoes/olist/callback`
  - Production: `https://your-domain.com/integracoes/olist/callback`
  - Required for: OAuth callback handling

- **OLIST_STATE_SECRET**
  - Description: Secret for OAuth state validation
  - Generated: Random 32-character string
  - Example: `$(openssl rand -hex 16)`
  - Required for: CSRF protection in OAuth flow

- **OLIST_RATE_LIMIT_PER_MINUTE**
  - Description: API rate limit for Olist requests
  - Default: `25` (Crescer plan limit)
  - Range: 1-30 (check your Olist plan)
  - Optional: Can be left unset to use default

### SumUp Integration

Enable payment method synchronization from SumUp.

- **SUMUP_API_KEY**
  - Description: SumUp API key for payment sync
  - Get from: [SumUp Dashboard](https://www.sumup.com)
  - Required for: Payment transactions sync, transaction history

- **SUMUP_MERCHANT_CODE**
  - Description: Your SumUp merchant code
  - Format: Usually alphanumeric identifier
  - Required for: Merchant account identification

### Database Migrations

- **DATABASE_URL**
  - Description: Direct PostgreSQL connection string (for migrations)
  - Example: `postgresql://user:password@localhost:5432/cashflow`
  - Used in: Migration scripts, direct database operations
  - Optional: Only needed for running direct migration scripts

## Environment Validation

### Build Time Validation

The application validates required environment variables during the build process. If any required variable is missing, the build will fail with a clear error message.

```bash
npm run build
# Error: Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL, ...
```

### Runtime Validation

Runtime validation checks can be run at any time:

```bash
npm run check:env
```

Output example:
```
🔍 Checking environment variables...

✅ NEXT_PUBLIC_SUPABASE_URL: https://your-project.s...
✅ NEXT_PUBLIC_SUPABASE_ANON_KEY: eyJhbGc...
✅ SUPABASE_SERVICE_ROLE_KEY: eyJhbGc...
⚠️  NOT SET: OLIST_CLIENT_ID
⚠️  NOT SET: SUMUP_API_KEY

📊 Summary: 3 required OK, 5 optional configured
✅ All environment validations passed!
```

## Development Setup

### Local Development

1. **Create .env.local file:**
   ```bash
   cp .env.example .env.local
   ```

2. **Fill in required variables:**
   - Get Supabase credentials from your project settings
   - Supabase Test URL: `http://localhost:54321` (if using local Supabase)
   - Supabase Anon Key: Get from local Supabase startup output

3. **Verify configuration:**
   ```bash
   npm run check:env
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

### With Docker

If running Supabase locally via Docker:

```bash
# Start Supabase
supabase start

# Copy the printed values to .env.local
export NEXT_PUBLIC_SUPABASE_URL="http://localhost:54321"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."

# Verify
npm run check:env

# Start dev server
npm run dev
```

## Production Deployment

### Pre-deployment Checklist

- [ ] All required environment variables are set in your deployment platform
- [ ] Service role key is stored securely (GitHub Secrets, Vercel Secrets, etc.)
- [ ] Run `npm run check:env` in CI/CD pipeline
- [ ] Build successfully: `npm run build`
- [ ] No console warnings about missing variables

### GitHub Actions / CI/CD

Set the following secrets in your GitHub repository:

1. Go to **Settings → Secrets and variables → Actions**
2. Add these secrets:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OLIST_CLIENT_ID`
   - `OLIST_CLIENT_SECRET`
   - `OLIST_REDIRECT_URI`
   - `OLIST_STATE_SECRET`
   - `SUMUP_API_KEY`
   - `SUMUP_MERCHANT_CODE`
   - `DATABASE_URL`

### Vercel Deployment

1. Go to **Project Settings → Environment Variables**
2. Add all required variables
3. For secrets, use **Sensitive** toggle
4. Set different values for **Production**, **Preview**, and **Development**

Example:
```
Production: https://your-project.supabase.co (main domain)
Preview:    https://staging.supabase.co (preview URLs)
Development: http://localhost:54321 (local testing)
```

## Troubleshooting

### "Missing required environment variables" error

**Cause:** One or more required variables are not set.

**Solution:**
```bash
npm run check:env
```

This shows exactly which variables are missing. Add them to `.env.local` or your deployment platform's environment variables section.

### Build fails with environment error

**Cause:** Required variables missing during `npm run build`.

**Solution:**
1. Verify `.env.local` exists and is readable
2. Check that all required variables have values (not empty strings)
3. Run `npm run check:env` to get detailed diagnostics
4. Verify Supabase URL is HTTPS (not HTTP in production)

### "Supabase connection failed" at runtime

**Cause:** Invalid Supabase URL or key.

**Solution:**
1. Verify Supabase URL format: `https://project-id.supabase.co`
2. Verify keys are not truncated or corrupted
3. Check Supabase project status is "Active"
4. Test connection: `curl https://your-url/rest/v1/health`

### Olist/SumUp sync not working

**Cause:** Optional integration variables not set.

**Solution:**
1. Check which integration you need (Olist, SumUp, or both)
2. Run `npm run check:env` to see status
3. Get credentials from respective dashboards
4. Add variables to `.env.local`
5. Restart dev server or redeploy

## Security Best Practices

✅ **DO:**
- Store secrets in GitHub Secrets, Vercel Environment Variables, or secure vaults
- Rotate keys regularly (every 90 days recommended)
- Use different keys for each environment (dev, staging, production)
- Review the CI/CD workflow to ensure secrets are not logged
- Keep `.env.local` in `.gitignore` (never commit secrets)

❌ **DON'T:**
- Commit `.env.local` or any file with sensitive keys to git
- Share API keys in Slack, email, or tickets
- Use the same key across multiple environments
- Log or print full API keys (only show first 20 chars)
- Use production keys in development

## Environment Variables Reference

| Variable | Required | Type | Scope | Purpose |
|----------|----------|------|-------|---------|
| NEXT_PUBLIC_SUPABASE_URL | Yes | Public | Frontend+Backend | Database URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Yes | Public | Frontend+Backend | Auth key |
| SUPABASE_SERVICE_ROLE_KEY | Yes | Secret | Backend | Admin database access |
| OLIST_CLIENT_ID | No | Secret | Backend | Marketplace auth |
| OLIST_CLIENT_SECRET | No | Secret | Backend | Marketplace auth |
| OLIST_REDIRECT_URI | No | Public | Backend | OAuth callback |
| OLIST_STATE_SECRET | No | Secret | Backend | OAuth security |
| OLIST_RATE_LIMIT_PER_MINUTE | No | Config | Backend | API rate limit |
| SUMUP_API_KEY | No | Secret | Backend | Payment sync |
| SUMUP_MERCHANT_CODE | No | Config | Backend | Merchant ID |
| DATABASE_URL | No | Secret | Backend | Direct DB access |

## Support

For issues or questions:
- 📖 Check this guide first
- 🐛 Run `npm run check:env` for diagnostics
- 📝 Review `.env.example` for variable names
- 💬 Open an issue with output from `npm run check:env`
