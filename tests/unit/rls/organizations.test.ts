import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const admin = createClient(url, serviceKey)

const OUTSIDER_EMAIL = `outsider-${crypto.randomUUID()}@example.test`
const OUTSIDER_PASSWORD = `${crypto.randomUUID()}Aa1!`

// Best-effort lookup + delete of any pre-existing user with this email.
// Guards against orphaned state from a previous interrupted run (process
// killed mid-test, an uncaught exception between beforeAll and afterAll,
// deleteUser itself failing) — without this, a stale user from a bad prior
// run makes every subsequent `npm run test:rls` fail at createUser with a
// duplicate-email error, and nothing self-heals.
async function deleteExistingOutsiderIfAny(): Promise<void> {
  let page = 1
  const perPage = 1000
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const match = data.users.find((u) => u.email === OUTSIDER_EMAIL)
    if (match) {
      await admin.auth.admin.deleteUser(match.id)
      return
    }
    if (data.users.length < perPage) return // no more pages
    page += 1
  }
}

describe('RLS: organizations isolation', () => {
  let outsiderUserId: string

  beforeAll(async () => {
    await deleteExistingOutsiderIfAny()

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
