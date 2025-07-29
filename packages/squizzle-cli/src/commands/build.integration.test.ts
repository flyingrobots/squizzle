import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildCommand } from './build'
import { createOCIStorage } from '@squizzle/oci'
import { Config } from '../config'
import * as fs from 'fs/promises'
import * as path from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

// Integration tests with real registry
// Requires:
// - SQUIZZLE_TEST_REGISTRY env var (e.g., ghcr.io)
// - SQUIZZLE_TEST_REPOSITORY env var (e.g., your-org/squizzle-test)
// - Being logged in to the registry (docker login)

describe('build command integration with real registry', () => {
  let tempDir: string
  let config: Config
  let testVersion: string
  
  const registry = process.env.SQUIZZLE_TEST_REGISTRY
  const repository = process.env.SQUIZZLE_TEST_REPOSITORY
  
  // Skip tests if registry not configured
  const skipMessage = !registry || !repository 
    ? 'Skipping: Set SQUIZZLE_TEST_REGISTRY and SQUIZZLE_TEST_REPOSITORY env vars'
    : undefined
    
  beforeAll(async () => {
    if (skipMessage) return
    
    // Create temp directory for test files
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'squizzle-test-'))
    
    // Setup test project structure
    await fs.mkdir(path.join(tempDir, 'db', 'drizzle'), { recursive: true })
    await fs.mkdir(path.join(tempDir, 'db', 'tarballs'), { recursive: true })
    await fs.mkdir(path.join(tempDir, '.squizzle', 'build'), { recursive: true })
    
    // Create test migration files
    await fs.writeFile(
      path.join(tempDir, 'db', 'drizzle', '0001_initial.sql'),
      'CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL);'
    )
    
    await fs.writeFile(
      path.join(tempDir, 'db', 'drizzle', '0002_add_created_at.sql'),
      'ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT NOW();'
    )
    
    // Create package.json
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'squizzle-integration-test',
        devDependencies: {
          'drizzle-kit': '^0.20.0'
        }
      })
    )
    
    // Setup config
    config = {
      version: '2.0',
      storage: {
        type: 'oci',
        registry: registry!,
        repository: repository!
      },
      environments: {
        development: {
          database: {
            host: 'localhost',
            port: 5432,
            database: 'test',
            user: 'test',
            password: 'test'
          }
        }
      }
    }
    
    // Generate unique test version
    testVersion = `99.99.${Date.now()}`
  })
  
  afterAll(async () => {
    if (skipMessage) return
    
    // Cleanup: Delete test version from registry
    if (testVersion) {
      try {
        const storage = createOCIStorage(config.storage as any)
        await storage.delete(testVersion)
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    // Remove temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
  
  beforeEach(() => {
    if (skipMessage) return
    
    // Mock process.cwd for the build command
    const originalCwd = process.cwd
    process.cwd = () => tempDir
    
    // Restore after test
    return () => {
      process.cwd = originalCwd
    }
  })
  
  it.skipIf(skipMessage)('should build and push artifact to real registry', async () => {
    const options = {
      notes: 'Integration test with real registry',
      author: 'test-suite',
      config
    }
    
    // Mock execSync to avoid running actual drizzle-kit
    const originalExecSync = execSync
    ;(global as any).execSync = () => Buffer.from('')
    
    try {
      // Build and push
      await buildCommand(testVersion, options)
      
      // Verify artifact was pushed by checking it exists
      const storage = createOCIStorage(config.storage as any)
      const exists = await storage.exists(testVersion)
      expect(exists).toBe(true)
      
      // Verify we can retrieve the manifest
      const manifest = await storage.getManifest(testVersion)
      expect(manifest.version).toBe(testVersion)
      expect(manifest.notes).toBe('Integration test with real registry')
      expect(manifest.author).toBe('test-suite')
      expect(manifest.files).toHaveLength(2)
      
      // Verify tarball was created locally
      const tarballPath = path.join(tempDir, 'db', 'tarballs', `squizzle-v${testVersion}.tar.gz`)
      const tarballExists = await fs.access(tarballPath).then(() => true).catch(() => false)
      expect(tarballExists).toBe(true)
    } finally {
      ;(global as any).execSync = originalExecSync
    }
  })
  
  it.skipIf(skipMessage)('should skip push with --skip-push flag', async () => {
    const localVersion = `99.98.${Date.now()}`
    const options = {
      notes: 'Skip push test',
      config,
      skipPush: true
    }
    
    // Mock execSync
    const originalExecSync = execSync
    ;(global as any).execSync = () => Buffer.from('')
    
    try {
      await buildCommand(localVersion, options)
      
      // Verify tarball was created locally
      const tarballPath = path.join(tempDir, 'db', 'tarballs', `squizzle-v${localVersion}.tar.gz`)
      const tarballExists = await fs.access(tarballPath).then(() => true).catch(() => false)
      expect(tarballExists).toBe(true)
      
      // Verify it was NOT pushed to registry
      const storage = createOCIStorage(config.storage as any)
      const exists = await storage.exists(localVersion)
      expect(exists).toBe(false)
    } finally {
      ;(global as any).execSync = originalExecSync
    }
  })
  
  it.skipIf(skipMessage)('should use environment variable overrides', async () => {
    // Set different registry/repo via env vars
    process.env.SQUIZZLE_REGISTRY = registry
    process.env.SQUIZZLE_REPOSITORY = repository
    
    const envVersion = `99.97.${Date.now()}`
    const options = {
      notes: 'Environment override test',
      config: {
        ...config,
        storage: {
          ...config.storage,
          registry: 'wrong-registry.com',
          repository: 'wrong/repo'
        }
      }
    }
    
    // Mock execSync
    const originalExecSync = execSync
    ;(global as any).execSync = () => Buffer.from('')
    
    try {
      await buildCommand(envVersion, options)
      
      // Verify it was pushed to the env var registry, not the config one
      const storage = createOCIStorage({
        type: 'oci',
        registry: registry!,
        repository: repository!
      } as any)
      const exists = await storage.exists(envVersion)
      expect(exists).toBe(true)
      
      // Cleanup
      await storage.delete(envVersion)
    } finally {
      ;(global as any).execSync = originalExecSync
      delete process.env.SQUIZZLE_REGISTRY
      delete process.env.SQUIZZLE_REPOSITORY
    }
  })
  
  it.skipIf(skipMessage)('should verify push and retrieve manifest after upload', async () => {
    const verifyVersion = `99.96.${Date.now()}`
    const options = {
      notes: 'Verification test',
      author: 'integration-test',
      config
    }
    
    // Mock execSync
    const originalExecSync = execSync
    ;(global as any).execSync = () => Buffer.from('')
    
    // Spy on console.warn to ensure no warnings
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    
    try {
      await buildCommand(verifyVersion, options)
      
      // Should not have any warnings
      expect(consoleWarn).not.toHaveBeenCalled()
      
      // Manually verify the push
      const storage = createOCIStorage(config.storage as any)
      const exists = await storage.exists(verifyVersion)
      expect(exists).toBe(true)
      
      const manifest = await storage.getManifest(verifyVersion)
      expect(manifest.version).toBe(verifyVersion)
      
      // Cleanup
      await storage.delete(verifyVersion)
    } finally {
      ;(global as any).execSync = originalExecSync
      consoleWarn.mockRestore()
    }
  })
  
  it.skipIf(skipMessage)('should list versions including newly pushed one', async () => {
    const listVersion = `99.95.${Date.now()}`
    const options = {
      notes: 'List test',
      config
    }
    
    // Mock execSync
    const originalExecSync = execSync
    ;(global as any).execSync = () => Buffer.from('')
    
    try {
      // Get list before push
      const storage = createOCIStorage(config.storage as any)
      const versionsBefore = await storage.list()
      
      // Build and push
      await buildCommand(listVersion, options)
      
      // Get list after push
      const versionsAfter = await storage.list()
      
      // Should have one more version
      expect(versionsAfter.length).toBe(versionsBefore.length + 1)
      expect(versionsAfter).toContain(listVersion)
      
      // Cleanup
      await storage.delete(listVersion)
    } finally {
      ;(global as any).execSync = originalExecSync
    }
  })
})