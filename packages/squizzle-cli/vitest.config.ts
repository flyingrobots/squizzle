import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html']
    }
  },
  resolve: {
    alias: {
      '@squizzle/core': path.resolve(__dirname, '../squizzle-core/src/index.ts'),
      '@squizzle/postgres': path.resolve(__dirname, '../squizzle-postgres/src/index.ts'),
      '@squizzle/oci': path.resolve(__dirname, '../squizzle-oci/src/index.ts'),
      '@squizzle/security': path.resolve(__dirname, '../squizzle-security/src/index.ts')
    }
  }
})