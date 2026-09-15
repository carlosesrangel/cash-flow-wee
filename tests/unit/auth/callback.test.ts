import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/lib/auth/invitation', () => ({ acceptPendingInvitations: vi.fn() }))

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { acceptPendingInvitations } from '@/lib/auth/invitation'

describe('Supabase auth callback', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends an invited user to the password setup page after a token-hash confirmation', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null })
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'invited-user' } }, error: null })
    vi.mocked(createServerSupabaseClient).mockResolvedValue({ auth: { verifyOtp, getUser } } as never)
    vi.mocked(acceptPendingInvitations).mockResolvedValue(1)

    const { GET } = await import('@/app/auth/callback/route')
    const response = await GET(new Request('https://wee.example/auth/callback?token_hash=hash&type=invite'))

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'hash', type: 'invite' })
    expect(acceptPendingInvitations).toHaveBeenCalledWith('invited-user')
    expect(response.headers.get('location')).toBe('https://wee.example/auth/set-password')
  })

  it('keeps regular code callbacks on the dashboard', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(createServerSupabaseClient).mockResolvedValue({ auth: { exchangeCodeForSession } } as never)

    const { GET } = await import('@/app/auth/callback/route')
    const response = await GET(new Request('https://wee.example/auth/callback?code=code'))

    expect(exchangeCodeForSession).toHaveBeenCalledWith('code')
    expect(response.headers.get('location')).toBe('https://wee.example/visao-geral')
  })
})
