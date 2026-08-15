import { defineConfig } from 'vitest/config'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '.env.local') })

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // Same reasoning as vitest.config.ts: the real `server-only` package
      // throws unconditionally outside Next's webpack build, but this suite
      // imports real server modules (the reconciliation engine, the confirm
      // route) under plain Node/Vitest.
      'server-only': path.resolve(__dirname, 'tests/unit/__mocks__/server-only.ts'),
    },
  },
})
