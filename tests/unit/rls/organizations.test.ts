import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(url, serviceKey)

const OUTSIDER_EMAIL = 'outsider-rls-test@wee.com.br'
const OUTSIDER_PASSWORD = 'senha12345'

describe('RLS: organizations isolation', () => {
  let outsiderUserId: string

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: OUTSIDER_EMAIL,
      password: OUTSIDER_PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    outsiderUserId = data.user.id
    // Deliberately NOT added to organization_members — this user belongs to no org.
  })

  afterAll(async () => {
    await admin.auth.admin.deleteUser(outsiderUserId)
  })

  it('a user with no organization membership sees zero organizations', async () => {
    const outsiderClient = createClient(url, anonKey)
    const { error: signInError } = await outsiderClient.auth.signInWithPassword({
      email: OUTSIDER_EMAIL,
      password: OUTSIDER_PASSWORD,
    })
    expect(signInError).toBeNull()

    const { data, error } = await outsiderClient.from('organizations').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a user with no organization membership sees zero organization_members rows', async () => {
    const outsiderClient = createClient(url, anonKey)
    await outsiderClient.auth.signInWithPassword({
      email: OUTSIDER_EMAIL,
      password: OUTSIDER_PASSWORD,
    })

    const { data, error } = await outsiderClient.from('organization_members').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
