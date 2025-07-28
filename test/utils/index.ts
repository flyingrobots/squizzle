import { DatabaseDriver } from '@squizzle/core'
import { createPostgresDriver } from '@squizzle/postgres'
import { Storage, Manifest, Version } from '@squizzle/core'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { create } from 'tar'
import { createHash } from 'crypto'
import { Readable } from 'stream'

export interface TestContext {
  driver: DatabaseDriver
  tempDir: string
  cleanup: () => Promise<void>
}

/**
 * Create a test database instance with proper cleanup
 */
export async function createTestDatabase(): Promise<TestContext> {
  const tempDir = await mkdtemp(join(tmpdir(), 'squizzle-test-'))
  
  const driver = createPostgresDriver({
    host: process.env.TEST_DB_HOST || 'localhost',
    port: parseInt(process.env.TEST_DB_PORT || '54336'),
    database: process.env.TEST_DB_NAME || 'squizzle_test',
    user: process.env.TEST_DB_USER || 'postgres',
    password: process.env.TEST_DB_PASSWORD || 'testpass'
  })
  
  await driver.connect()
  
  // Ensure system tables exist
  await driver.execute(`
    CREATE TABLE IF NOT EXISTS squizzle_versions (
      version VARCHAR(50) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      success BOOLEAN DEFAULT true,
      error TEXT
    )
  `)
  
  const cleanup = async () => {
    await driver.disconnect()
    await rm(tempDir, { recursive: true })
  }
  
  return { driver, tempDir, cleanup }
}

/**
 * Create a mock storage implementation for unit tests
 */
export function createMockStorage(): Storage & { artifacts: Map<Version, { buffer: Buffer, manifest: Manifest }> } {
  const artifacts = new Map<Version, { buffer: Buffer, manifest: Manifest }>()
  
  return {
    artifacts,
    
    async push(version: Version, artifact: Buffer, manifest: Manifest): Promise<string> {
      artifacts.set(version, { buffer: artifact, manifest })
      return `mock://storage/${version}`
    },
    
    async pull(version: Version): Promise<{ artifact: Buffer, manifest: Manifest }> {
      const data = artifacts.get(version)
      if (!data) {
        throw new Error(`Artifact for version ${version} not found`)
      }
      return data
    },
    
    async list(): Promise<Version[]> {
      return Array.from(artifacts.keys()).sort()
    },
    
    async delete(version: Version): Promise<void> {
      artifacts.delete(version)
    }
  }
}

/**
 * Generate a test manifest with sensible defaults
 */
export function generateTestManifest(options: Partial<Manifest> = {}): Manifest {
  const defaults: Manifest = {
    version: '1.0.0' as Version,
    createdAt: new Date().toISOString(),
    createdBy: 'test-user',
    drizzleVersion: '0.25.0',
    notes: 'Test migration',
    files: [
      {
        path: '0001_test_migration.sql',
        checksum: 'abc123',
        size: 100,
        order: 1
      }
    ],
    checksum: 'manifest-checksum',
    dependencies: []
  }
  
  return { ...defaults, ...options }
}

/**
 * Create a test migration SQL file
 */
export function createTestMigration(name: string, content?: string): { path: string, content: string, checksum: string } {
  const defaultContent = content || `
    -- Test migration: ${name}
    CREATE TABLE IF NOT EXISTS ${name}_table (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    INSERT INTO ${name}_table (name) VALUES ('test_data');
  `
  
  const checksum = createHash('sha256').update(defaultContent).digest('hex')
  
  return {
    path: `${name}.sql`,
    content: defaultContent,
    checksum
  }
}

/**
 * Create a test artifact buffer from migrations
 */
export async function createTestArtifact(migrations: Array<{ path: string, content: string }>, manifest: Manifest): Promise<Buffer> {
  const tempDir = await mkdtemp(join(tmpdir(), 'artifact-'))
  
  try {
    // Write migrations to temp dir
    const { writeFile } = await import('fs/promises')
    for (const migration of migrations) {
      await writeFile(join(tempDir, migration.path), migration.content)
    }
    
    // Write manifest
    await writeFile(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    
    // Create tarball
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = create({
        gzip: true,
        cwd: tempDir
      }, [...migrations.map(m => m.path), 'manifest.json'])
      
      stream.on('data', chunk => chunks.push(chunk))
      stream.on('end', resolve)
      stream.on('error', reject)
    })
    
    return Buffer.concat(chunks)
  } finally {
    await rm(tempDir, { recursive: true })
  }
}

/**
 * Assert that a migration was applied successfully
 */
export async function assertMigrationApplied(driver: DatabaseDriver, version: Version, tableName?: string) {
  // Check version record
  const versions = await driver.getAppliedVersions()
  const applied = versions.find(v => v.version === version)
  if (!applied) {
    throw new Error(`Version ${version} not found in applied versions`)
  }
  if (!applied.success) {
    throw new Error(`Version ${version} was not successful: ${applied.error}`)
  }
  
  // Optionally check table exists
  if (tableName) {
    const tables = await driver.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = $1
    `, [tableName])
    
    if (tables.length === 0) {
      throw new Error(`Table ${tableName} does not exist`)
    }
  }
}

/**
 * Clean up test data from database
 */
export async function cleanupTestData(driver: DatabaseDriver) {
  // Get all non-system tables
  const tables = await driver.query<{ table_name: string }>(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name != 'squizzle_versions'
    AND table_name NOT LIKE 'pg_%'
  `)
  
  // Drop all test tables
  for (const { table_name } of tables) {
    await driver.execute(`DROP TABLE IF EXISTS ${table_name} CASCADE`)
  }
  
  // Clear version history
  await driver.execute('TRUNCATE TABLE squizzle_versions')
}

/**
 * Create test context with automatic cleanup
 */
export async function withTestContext<T>(
  fn: (context: TestContext) => Promise<T>
): Promise<T> {
  const context = await createTestDatabase()
  try {
    return await fn(context)
  } finally {
    await context.cleanup()
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  throw new Error('Timeout waiting for condition')
}

/**
 * Create a test driver factory for different database types
 */
export function createTestDriver(type: 'postgres' | 'mysql' | 'sqlite' = 'postgres'): DatabaseDriver {
  switch (type) {
    case 'postgres':
      return createPostgresDriver({
        host: 'localhost',
        port: 54336,
        database: 'squizzle_test',
        user: 'postgres',
        password: 'testpass'
      })
    default:
      throw new Error(`Unsupported database type: ${type}`)
  }
}