import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 60000, // Integration tests can take longer
    hookTimeout: 30000, // Container startup can take time
    teardownTimeout: 10000, // Container cleanup
    pool: 'forks', // Better isolation for integration tests
    poolOptions: {
      forks: {
        singleFork: true // Run tests sequentially to avoid port conflicts
      }
    }
  },
  resolve: {
    alias: {
      '@squizzle/core': path.resolve(__dirname, '../../packages/squizzle-core/src/index.ts'),
      '@squizzle/postgres': path.resolve(__dirname, '../../packages/squizzle-postgres/src/index.ts'),
      '@squizzle/oci': path.resolve(__dirname, '../../packages/squizzle-oci/src/index.ts'),
      '@squizzle/security': path.resolve(__dirname, '../../packages/squizzle-security/src/index.ts')
    }
  }
})