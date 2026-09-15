import { expect, it } from 'vitest'
import { incrementalSince } from '@/lib/integrations/checkpoint'

it('recovers outages from the last successful start with overlap', () => {
  expect(incrementalSince('2026-09-02T12:00:00Z')?.toISOString()).toBe('2026-09-01T12:00:00.000Z')
})
it('uses a full recovery when no checkpoint exists', () => { expect(incrementalSince(null)).toBeUndefined() })
it('refuses malformed checkpoints', () => { expect(() => incrementalSince('bad')).toThrow() })
