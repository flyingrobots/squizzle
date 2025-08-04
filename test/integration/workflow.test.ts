import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { IntegrationTestEnv, setupIntegrationTest, getConnectionString } from './setup'
import { runCliCommand, createTestMigration, createTestProject } from './helpers'
import { createPostgresDriver } from '@squizzle/postgres'
import { createOCIStorage } from '@squizzle/oci'
import { existsSync } from 'fs'
import { join } from 'path'

describe('Squizzle End-to-End Workflow', () => {
  let testEnv: IntegrationTestEnv
  
  beforeAll(async () => {
    testEnv = await setupIntegrationTest()
  }, 30000) // Container startup can take time
  
  afterAll(async () => {
    await testEnv.cleanup()
  })
  
  it('should complete full migration lifecycle', async () => {
    // 1. Create test project structure
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres),
      registryUrl: testEnv.registry.url
    })
    
    // 2. Initialize database
    const initResult = await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    expect(initResult.exitCode).toBe(0)
    expect(initResult.stdout).toContain('System tables initialized')
    
    // 3. Create test migrations
    await createTestMigration(testEnv.tempDir, '0001_initial.sql', `
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `)
    
    await createTestMigration(testEnv.tempDir, '0002_add_profile.sql', `
      CREATE TABLE profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        bio TEXT,
        avatar_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `)
    
    // 4. Build artifact
    const buildResult = await runCliCommand([
      'build', '1.0.0',
      '--notes', 'Initial schema with users and profiles',
      '--drizzle-path', join(testEnv.tempDir, 'drizzle')
    ], { 
      cwd: testEnv.tempDir 
    })
    expect(buildResult.exitCode).toBe(0)
    expect(buildResult.stdout).toContain('Built squizzle-v1.0.0.tar.gz')
    
    // Verify artifact was created
    const artifactPath = join(testEnv.tempDir, 'squizzle-v1.0.0.tar.gz')
    expect(existsSync(artifactPath)).toBe(true)
    
    // 5. Push to registry
    const storage = createOCIStorage({
      registry: testEnv.registry.url,
      repository: 'test/migrations',
      insecure: true // Local test registry
    })
    
    const pushResult = await runCliCommand([
      'push', '1.0.0',
      '--registry', testEnv.registry.url,
      '--repository', 'test/migrations',
      '--insecure'
    ], { 
      cwd: testEnv.tempDir 
    })
    expect(pushResult.exitCode).toBe(0)
    
    // 6. Apply migration
    const applyResult = await runCliCommand([
      'apply', '1.0.0',
      '--registry', testEnv.registry.url,
      '--repository', 'test/migrations',
      '--insecure'
    ], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    expect(applyResult.exitCode).toBe(0)
    expect(applyResult.stdout).toContain('Successfully applied version 1.0.0')
    
    // 7. Verify application
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    try {
      const userTables = await driver.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
      `)
      expect(userTables).toHaveLength(1)
      
      const profileTables = await driver.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'profiles'
      `)
      expect(profileTables).toHaveLength(1)
    } finally {
      await driver.disconnect()
    }
    
    // 8. Check status
    const statusResult = await runCliCommand(['status'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    expect(statusResult.exitCode).toBe(0)
    expect(statusResult.stdout).toContain('Current version: 1.0.0')
    expect(statusResult.stdout).toContain('Total migrations applied: 1')
    
    // 9. Verify integrity
    const verifyResult = await runCliCommand(['verify', '1.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    expect(verifyResult.exitCode).toBe(0)
    expect(verifyResult.stdout).toContain('Integrity check passed')
  }, 60000) // Full workflow can take time
  
  it('should handle incremental migrations', async () => {
    // Apply first version
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    await createTestMigration(testEnv.tempDir, '0001_initial.sql', `
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price DECIMAL(10,2) NOT NULL
      );
    `)
    
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    await runCliCommand(['build', '1.0.0', '--notes', 'Initial products'], { 
      cwd: testEnv.tempDir 
    })
    
    await runCliCommand(['apply', '1.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Add more migrations
    await createTestMigration(testEnv.tempDir, '0002_add_inventory.sql', `
      CREATE TABLE inventory (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `)
    
    // Build and apply incremental version
    const buildResult = await runCliCommand([
      'build', '1.1.0',
      '--notes', 'Add inventory tracking',
      '--previous-version', '1.0.0'
    ], { 
      cwd: testEnv.tempDir 
    })
    expect(buildResult.exitCode).toBe(0)
    
    const applyResult = await runCliCommand(['apply', '1.1.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    expect(applyResult.exitCode).toBe(0)
    
    // Verify both tables exist
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    const tables = await driver.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('products', 'inventory')
      ORDER BY table_name
    `)
    expect(tables).toHaveLength(2)
    expect(tables[0].table_name).toBe('inventory')
    expect(tables[1].table_name).toBe('products')
    
    await driver.disconnect()
  }, 30000)
})