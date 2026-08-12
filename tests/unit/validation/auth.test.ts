import { describe, it, expect } from 'vitest'
import { loginSchema, inviteMemberSchema } from '@/lib/validation/auth'

describe('loginSchema', () => {
  it('accepts a valid email and non-empty password', () => {
    const result = loginSchema.safeParse({ email: 'a@wee.com.br', password: 'senha123' })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'senha123' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'a@wee.com.br', password: '' })
    expect(result.success).toBe(false)
  })
})

describe('inviteMemberSchema', () => {
  it('accepts a valid email and role', () => {
    const result = inviteMemberSchema.safeParse({ email: 'a@wee.com.br', role: 'MANAGER' })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid role', () => {
    const result = inviteMemberSchema.safeParse({ email: 'a@wee.com.br', role: 'SUPERUSER' })
    expect(result.success).toBe(false)
  })
})
