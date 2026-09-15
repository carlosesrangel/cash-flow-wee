import { expect, it, vi, afterEach } from 'vitest'
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: vi.fn() }))
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { withIntegrationLock } from '@/lib/integrations/lock'
afterEach(() => vi.clearAllMocks())

function client(acquired: boolean) {
  const chain = { eq: vi.fn(), then: (resolve: (value: unknown) => void) => resolve({ error: null }) }
  chain.eq.mockReturnValue(chain)
  const remove = vi.fn(() => chain)
  const rpc = vi.fn().mockResolvedValue({ data: acquired, error: null })
  vi.mocked(createAdminSupabaseClient).mockReturnValue({ rpc, from: () => ({ delete: remove }) } as never)
  return { rpc, remove, chain }
}
it('rejects simultaneous work before any token or data mutation', async () => {
  const c = client(false); const work = vi.fn()
  await expect(withIntegrationLock('org', 'olist-oauth', 60, work)).rejects.toThrow('already running')
  expect(work).not.toHaveBeenCalled(); expect(c.remove).not.toHaveBeenCalled()
})
it('releases only its own lease after success', async () => {
  const c = client(true)
  await expect(withIntegrationLock('org', 'olist-oauth', 60, async () => 42)).resolves.toBe(42)
  expect(c.chain.eq).toHaveBeenCalledWith('owner', expect.any(String))
})
it('releases after an upstream failure and propagates the failure', async () => {
  const c = client(true)
  await expect(withIntegrationLock('org', 'financial-sync', 10800, async () => { throw Error('upstream down') })).rejects.toThrow('upstream down')
  expect(c.remove).toHaveBeenCalledOnce()
})
