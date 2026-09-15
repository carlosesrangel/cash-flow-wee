import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { OrganizationRole } from '@/lib/validation/auth'

export type CurrentMember = {
  orgId: string
  profileId: string
  role: OrganizationRole
} | null

export async function getCurrentMember(): Promise<CurrentMember> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, profile_id, role')
    .eq('profile_id', user.id)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Falha ao carregar membership do usuário: ${error.message}`)
  }

  if (data) {
    return {
      orgId: data.org_id,
      profileId: data.profile_id,
      role: data.role as OrganizationRole,
    }
  }

  // Auth user creation and organization membership are intentionally
  // separate. A user created directly in Supabase must be invited/assigned
  // by an owner before seeing tenant data; never create an empty organization
  // implicitly because that makes a valid login look like an empty dashboard.
  return null
}
