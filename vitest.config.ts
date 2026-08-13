import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    // RLS tests hit a real local Supabase instance and run separately via `npm run test:rls`
    // (see vitest.config.rls.ts) — exclude them here so `npm run test` stays hermetic.
    exclude: ['**/node_modules/**', 'tests/unit/rls/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // The real `server-only` package throws unconditionally when imported outside of
      // Next.js's webpack build (it relies on webpack's server/client module graph to
      // suppress the throw on the server). Alias it to a no-op so unit tests — which run
      // under plain Node/Vitest, not Next's bundler — can still import modules that guard
      // against accidental client-side imports with `import 'server-only'`.
      'server-only': path.resolve(__dirname, 'tests/unit/__mocks__/server-only.ts'),
    },
  },
})
