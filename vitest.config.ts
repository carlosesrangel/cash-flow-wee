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
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
