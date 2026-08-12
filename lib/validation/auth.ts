import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

export const organizationRoleSchema = z.enum(['OWNER_ADMIN', 'MANAGER', 'VIEWER'])

export const inviteMemberSchema = z.object({
  email: z.string().email('E-mail inválido'),
  role: organizationRoleSchema,
})

export type LoginInput = z.infer<typeof loginSchema>
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>
export type OrganizationRole = z.infer<typeof organizationRoleSchema>
