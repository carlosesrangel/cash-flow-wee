import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

export const setPasswordSchema = z
  .object({
    password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres'),
    passwordConfirmation: z.string().min(1, 'Confirme a senha'),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'As senhas não conferem',
    path: ['passwordConfirmation'],
  })

export const organizationRoleSchema = z.enum(['OWNER_ADMIN', 'MANAGER', 'VIEWER'])

export const inviteMemberSchema = z.object({
  email: z.string().email('E-mail inválido'),
  role: organizationRoleSchema,
})

export type LoginInput = z.infer<typeof loginSchema>
export type SetPasswordInput = z.infer<typeof setPasswordSchema>
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>
export type OrganizationRole = z.infer<typeof organizationRoleSchema>
