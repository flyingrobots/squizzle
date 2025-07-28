import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MigrationEngine } from './engine'
import { createPostgresDriver } from '@squizzle/postgres'
import { FilesystemStorage } from '@squizzle/oci'
import { LocalSecurityProvider } from '@squizzle/security'
import { createManifest } from './manifest'
import { create } from 'tar'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

describe('MigrationEngine', () => {
  let engine: MigrationEngine
  let tempDir: string
  let driver: any

  beforeEach(async () => {
    // Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), 'squizzle-test-'))
    
    // Initialize driver with test database
    driver = createPostgresDriver({
      host: 'localhost',
      port: 54316, // Use PG 16 for tests
      database: 'squizzle_test',
      user: 'postgres',
      password: 'testpass'
    })
    
    // Connect and clean database
    await driver.connect()
    await driver.execute('DROP TABLE IF EXISTS squizzle_versions CASCADE')
    await driver.execute('DROP TABLE IF EXISTS test_table CASCADE')
    
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
      // Create test migration
      const version = '1.0.0'
      const sql = 'CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT);'
      
      // Create artifact
      const artifact = await createTestArtifact(version, [
        { path: 'drizzle/001_create_table.sql', content: sql, type: 'drizzle' }
      ])
      
      // Push to storage
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifact.buffer, artifact.manifest)
      
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
      const version = '1.0.0'
      const sql = 'CREATE TABLE INVALID SQL HERE;'
      
      const artifact = await createTestArtifact(version, [
        { path: 'drizzle/001_bad.sql', content: sql, type: 'drizzle' }
      ])
      
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifact.buffer, artifact.manifest)
      
      // Should throw error
      await expect(engine.apply(version)).rejects.toThrow()
      
      // Verify failure recorded
      const versions = await driver.getAppliedVersions()
      expect(versions).toHaveLength(1)
      expect(versions[0].success).toBe(false)
    })

    it('should run migrations in correct order', async () => {
      const version = '1.0.0'
      const migrations = [
        { path: 'squizzle/002_custom.sql', content: 'INSERT INTO test_table (name) VALUES (\'custom\');', type: 'custom' as const },
        { path: 'drizzle/001_create.sql', content: 'CREATE TABLE test_table (id SERIAL PRIMARY KEY, name TEXT);', type: 'drizzle' as const },
        { path: 'squizzle/003_seed.sql', content: 'INSERT INTO test_table (name) VALUES (\'seed\');', type: 'seed' as const }
      ]
      
      const artifact = await createTestArtifact(version, migrations)
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifact.buffer, artifact.manifest)
      
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
      const sql = 'CREATE TABLE test_table (id SERIAL PRIMARY KEY);'
      
      const artifact = await createTestArtifact(version, [
        { path: 'drizzle/001_create.sql', content: sql, type: 'drizzle' }
      ])
      
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifact.buffer, artifact.manifest)
      
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
      const version = '1.0.0'
      const artifact = await createTestArtifact(version, [
        { path: 'drizzle/001_test.sql', content: 'SELECT 1;', type: 'drizzle' }
      ])
      
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifact.buffer, artifact.manifest)
      
      const result = await engine.verify(version)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect missing artifact', async () => {
      const result = await engine.verify('99.99.99')
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Artifact for version 99.99.99 not found')
    })
  })

  describe('status', () => {
    it('should return current status', async () => {
      // Apply a version
      const version = '1.0.0'
      const artifact = await createTestArtifact(version, [
        { path: 'drizzle/001_test.sql', content: 'SELECT 1;', type: 'drizzle' }
      ])
      
      const storage = engine['storage'] as FilesystemStorage
      await storage.push(version, artifact.buffer, artifact.manifest)
      await engine.apply(version)
      
      // Get status
      const status = await engine.status()
      expect(status.current).toBe(version)
      expect(status.applied).toHaveLength(1)
      expect(status.available).toContain(version)
    })
  })
})

async function createTestArtifact(
  version: string,
  files: Array<{ path: string; content: string; type: 'drizzle' | 'custom' | 'seed' | 'rollback' }>
): Promise<{ buffer: Buffer; manifest: any }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'artifact-'))
  
  try {
    // Write files
    const fileBuffers = []
    for (const file of files) {
      const dir = join(tempDir, file.path.split('/')[0])
      await mkdir(dir, { recursive: true })
      const filePath = join(tempDir, file.path)
      await writeFile(filePath, file.content)
      fileBuffers.push({ path: file.path, content: Buffer.from(file.content), type: file.type })
    }
    
    // Create manifest
    const manifest = createManifest({
      version,
      notes: 'Test migration',
      drizzleKit: '0.20.0',
      files: fileBuffers
    })
    
    // Write manifest
    await writeFile(join(tempDir, 'manifest.json'), JSON.stringify(manifest))
    
    // Create tarball
    const tarPath = join(tempDir, 'artifact.tar.gz')
    await create({
      gzip: true,
      file: tarPath,
      cwd: tempDir
    }, ['.'])
    
    const buffer = require('fs').readFileSync(tarPath)
    
    return { buffer, manifest }
  } finally {
    await rm(tempDir, { recursive: true })
  }
}