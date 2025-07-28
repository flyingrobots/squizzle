import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { MigrationEngine } from './engine'
import { createPostgresDriver } from '@squizzle/postgres'
import { FilesystemStorage } from '@squizzle/oci'
import { LocalSecurityProvider } from '@squizzle/security'
import { createManifest } from './manifest'
import { create, extract } from 'tar'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { readFileSync } from 'fs'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { setupTestDatabase, cleanupTestDatabase } from '../test/setup'

// Helper to extract manifest from pre-built test artifact
async function extractManifestFromArtifact(artifactBuffer: Buffer): Promise<any> {
  const tempDir = await mkdtemp(join(tmpdir(), 'extract-'))
  
  try {
    // Extract to temp directory
    await pipeline(
      Readable.from(artifactBuffer),
      extract({ cwd: tempDir })
    )
    
    // Read manifest
    const manifestPath = join(tempDir, 'manifest.json')
    const manifestContent = readFileSync(manifestPath, 'utf-8')
    return JSON.parse(manifestContent)
  } finally {
    await rm(tempDir, { recursive: true })
  }
}

describe('MigrationEngine', () => {
  let engine: MigrationEngine
  let tempDir: string
  let driver: any

  beforeAll(async () => {
    // Ensure test database is set up
    await setupTestDatabase()
  })

  beforeEach(async () => {
    // Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), 'squizzle-test-'))
    
    // Initialize driver with test database
    driver = createPostgresDriver({
      host: 'localhost',
      port: 54336, // Test database port
      database: 'squizzle_test',
      user: 'postgres',
      password: 'testpass'
    })
    
    // Connect to database
    await driver.connect()
    
    // Clean up test data
    await cleanupTestDatabase()
    
    // Initialize engine
    engine = new MigrationEngine({
      driver,
      storage: new FilesystemStorage(join(tempDir, 'artifacts')),
      security: new LocalSecurityProvider('test-secret')
    })
  })

  afterEach(async () => {
    await driver.disconnect()
    await rm(tempDir, { recursive: true })
  })

  describe('apply', () => {
    it('should apply a simple migration', async () => {
      const version = '1.0.0'
      
      // Load pre-built test artifact
      const artifactPath = join(__dirname, '../test/artifacts/test-v1.0.0.tar.gz')
      const artifactBuffer = readFileSync(artifactPath)
      
      // Extract manifest from artifact for storage
      const manifest = await extractManifestFromArtifact(artifactBuffer)
      
      // Push to storage
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifactBuffer, manifest)
      
      // Apply migration
      await engine.apply(version)
      
      // Verify table exists
      const tables = await driver.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'test_table'
      `)
      expect(tables).toHaveLength(1)
      
      // Verify version recorded
      const versions = await driver.getAppliedVersions()
      expect(versions).toHaveLength(1)
      expect(versions[0].version).toBe(version)
      expect(versions[0].success).toBe(true)
    })

    it('should handle migration failures', async () => {
      const version = '1.0.1'
      
      // Clean up any existing version record
      await driver.execute(`DELETE FROM squizzle_versions WHERE version = '${version}'`)
      
      // Load pre-built test artifact with invalid SQL
      const artifactPath = join(__dirname, '../test/artifacts/test-v1.0.1.tar.gz')
      const artifactBuffer = readFileSync(artifactPath)
      const manifest = await extractManifestFromArtifact(artifactBuffer)
      
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifactBuffer, manifest)
      
      // Should throw error
      await expect(engine.apply(version)).rejects.toThrow()
      
      // Verify failure recorded
      const versions = await driver.getAppliedVersions()
      const failedVersion = versions.find(v => v.version === version)
      expect(failedVersion).toBeDefined()
      expect(failedVersion?.success).toBe(false)
    })

    it('should run migrations in correct order', async () => {
      const version = '1.0.2'
      
      // Load pre-built test artifact with multiple migrations
      const artifactPath = join(__dirname, '../test/artifacts/test-v1.0.2.tar.gz')
      const artifactBuffer = readFileSync(artifactPath)
      const manifest = await extractManifestFromArtifact(artifactBuffer)
      
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifactBuffer, manifest)
      
      await engine.apply(version)
      
      // Verify data inserted in correct order
      const rows = await driver.query('SELECT name FROM test_table ORDER BY id')
      expect(rows).toEqual([
        { name: 'custom' },
        { name: 'seed' }
      ])
    })

    it('should respect dry run option', async () => {
      const version = '1.0.0'
      
      // Load pre-built test artifact
      const artifactPath = join(__dirname, '../test/artifacts/test-v1.0.0.tar.gz')
      const artifactBuffer = readFileSync(artifactPath)
      const manifest = await extractManifestFromArtifact(artifactBuffer)
      
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifactBuffer, manifest)
      
      // Apply with dry run
      await engine.apply(version, { dryRun: true })
      
      // Verify table NOT created
      const tables = await driver.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'test_table'
      `)
      expect(tables).toHaveLength(0)
      
      // Verify version NOT recorded
      const versions = await driver.getAppliedVersions()
      expect(versions).toHaveLength(0)
    })
  })

  describe('verify', () => {
    it('should verify valid artifact', async () => {
      const version = '1.0.3'
      
      // Load pre-built test artifact
      const artifactPath = join(__dirname, '../test/artifacts/test-v1.0.3.tar.gz')
      const artifactBuffer = readFileSync(artifactPath)
      const manifest = await extractManifestFromArtifact(artifactBuffer)
      
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifactBuffer, manifest)
      
      const result = await engine.verify(version)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    }, 10000) // Increase timeout to 10 seconds

    it('should detect missing artifact', async () => {
      const result = await engine.verify('99.99.99')
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Artifact for version 99.99.99 not found')
    })
  })

  describe('status', () => {
    it('should return current status', async () => {
      const version = '1.0.3'
      
      // Load pre-built test artifact
      const artifactPath = join(__dirname, '../test/artifacts/test-v1.0.3.tar.gz')
      const artifactBuffer = readFileSync(artifactPath)
      const manifest = await extractManifestFromArtifact(artifactBuffer)
      
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifactBuffer, manifest)
      await engine.apply(version)
      
      // Get status
      const status = await engine.status()
      expect(status.current).toBe(version)
      expect(status.applied).toHaveLength(1)
      expect(status.available).toContain(version)
    })
  })
})

