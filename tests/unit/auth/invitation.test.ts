import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { acceptPendingInvitations, getInvitationRedirectUrl } from '@/lib/auth/invitation'

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL

afterEach(() => {
  vi.clearAllMocks()
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl
})

it('delegates invitation acceptance to the transactional database function', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ rpc } as never)

  await expect(acceptPendingInvitations('invited-user')).resolves.toBe(1)
  expect(rpc).toHaveBeenCalledWith('accept_organization_invitations', { p_profile_id: 'invited-user' })
})

describe('getInvitationRedirectUrl', () => {
  it('uses the configured public URL and preserves the password setup destination', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://wee.example/'

    expect(getInvitationRedirectUrl(new Request('http://localhost:3000/api/invitations'))).toBe(
      'https://wee.example/auth/complete?next=%2Fauth%2Fset-password'
    )
  })

  it('falls back to the request origin when no public URL is configured', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL

    expect(getInvitationRedirectUrl(new Request('http://localhost:3000/api/invitations'))).toBe(
      'http://localhost:3000/auth/complete?next=%2Fauth%2Fset-password'
    )
  })
})
