import { defineConfig } from 'vitest/config'
import path from 'path'
import dotenv from 'dotenv'

// Vitest does not auto-load .env.local like Next.js does; load it explicitly
// so process.env.NEXT_PUBLIC_SUPABASE_URL etc. are available in the test file.
dotenv.config({ path: path.resolve(__dirname, '.env.local') })

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/rls/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
