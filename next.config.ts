import type { NextConfig } from "next";

// Validate environment variables at build time
if (process.env.NODE_ENV === 'production') {
  try {
    // Dynamic import to avoid circular dependencies
    const { validateEnv } = require('./lib/env');
    validateEnv('build');
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Build environment validation failed:', error.message);
      process.exit(1);
    }
    throw error;
  }
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
