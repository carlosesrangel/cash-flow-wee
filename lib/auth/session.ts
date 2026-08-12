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
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Falha ao carregar membership do usuário: ${error.message}`)
  }

  if (!data) return null

  return {
    orgId: data.org_id,
    profileId: data.profile_id,
    role: data.role as OrganizationRole,
  }
}
