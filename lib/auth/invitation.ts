import { createAdminSupabaseClient } from '@/lib/supabase/admin'

/**
 * URL used by Supabase after an invitation is accepted.
 *
 * inviteUserByEmail does not use PKCE because the invite is usually opened in
 * a different browser from the one that sent it. The client landing page
 * handles the access-token fragment returned by Supabase.
 */
export function getInvitationRedirectUrl(request: Request): string {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const baseUrl = configuredSiteUrl ? new URL(configuredSiteUrl) : new URL(request.url)
  const redirectUrl = new URL('/auth/complete', baseUrl)
  redirectUrl.searchParams.set('next', '/auth/set-password')
  return redirectUrl.toString()
}

/**
 * Completes all pending invitations linked to a verified Supabase user.
 * The database function performs membership upsert and status transition in
 * one transaction, so a callback cannot leave only half of the acceptance.
 */
export async function acceptPendingInvitations(profileId: string): Promise<number> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.rpc('accept_organization_invitations', {
    p_profile_id: profileId,
  })

  if (error) {
    throw new Error(`Falha ao aceitar convite: ${error.message}`)
  }

  return typeof data === 'number' ? data : 0
}
