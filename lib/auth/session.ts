import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
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

  // Usuário não tem organização — criar uma padrão automaticamente
  const orgName = user.email ? user.email.split('@')[0] : 'Minha Organização'

  const admin = createAdminSupabaseClient()
  const { data: newOrg, error: orgError } = await admin
    .from('organizations')
    .insert([{ name: orgName }])
    .select('id')
    .single()

  if (orgError || !newOrg) {
    throw new Error(`Falha ao criar organização padrão: ${orgError?.message || 'Desconhecido'}`)
  }

  const { data: newMember, error: memberError } = await admin
    .from('organization_members')
    .insert([
      {
        org_id: newOrg.id,
        profile_id: user.id,
        role: 'OWNER_ADMIN',
      },
    ])
    .select('org_id, profile_id, role')
    .single()

  if (memberError || !newMember) {
    throw new Error(`Falha ao criar membership: ${memberError?.message || 'Desconhecido'}`)
  }

  return {
    orgId: newMember.org_id,
    profileId: newMember.profile_id,
    role: newMember.role as OrganizationRole,
  }
}
