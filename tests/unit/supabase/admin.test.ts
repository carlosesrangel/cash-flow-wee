import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('createAdminSupabaseClient', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('creates a client without throwing when both env vars are set', async () => {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    expect(() => createAdminSupabaseClient()).not.toThrow()
  })

  it('throws a clear error when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    expect(() => createAdminSupabaseClient()).toThrow()
  })
})
