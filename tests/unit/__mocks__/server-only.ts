// No-op stand-in for the `server-only` package under Vitest.
//
// The real package throws unconditionally on import; in a real Next.js build,
// webpack's server/client module graph analysis prevents that throw from ever
// firing for code that's actually only reachable from the server. Vitest runs
// under plain Node, not Next's bundler, so importing the real package here
// would break every test that transitively imports a module guarded with
// `import 'server-only'`. See vitest.config.ts for the alias that points here.
export {}
