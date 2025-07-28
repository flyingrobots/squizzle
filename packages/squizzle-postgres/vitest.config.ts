import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html']
    },
    setupFiles: ['../../test/setup.ts']
  },
  resolve: {
    alias: {
      '@squizzle/core': path.resolve(__dirname, '../squizzle-core/src/index.ts')
    }
  }
})