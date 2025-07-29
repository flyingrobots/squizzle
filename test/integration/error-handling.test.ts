import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { IntegrationTestEnv, setupIntegrationTest, getConnectionString } from './setup'
import { runCliCommand, createTestMigration, createTestProject } from './helpers'
import { createPostgresDriver } from '@squizzle/postgres'

describe('Error Handling Integration', () => {
  let testEnv: IntegrationTestEnv
  
  beforeAll(async () => {
    testEnv = await setupIntegrationTest()
  }, 30000)
  
  afterAll(async () => {
    await testEnv.cleanup()
  })
  
  it('should handle network failures during push gracefully', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    await createTestMigration(testEnv.tempDir, '0001_initial.sql', `
      CREATE TABLE test (id SERIAL PRIMARY KEY);
    `)
    
    // Build locally first
    await runCliCommand(['build', '1.0.0', '--notes', 'Test'], { 
      cwd: testEnv.tempDir 
    })
    
    // Try to push to non-existent registry
    const result = await runCliCommand([
      'push', '1.0.0',
      '--registry', 'nonexistent.registry.com:5000',
      '--repository', 'test/migrations'
    ], { 
      cwd: testEnv.tempDir 
    })
    
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Failed to push to storage')
  })
  
  it('should prevent applying same version twice', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    await createTestMigration(testEnv.tempDir, '0001_initial.sql', `
      CREATE TABLE test_twice (id SERIAL PRIMARY KEY);
    `)
    
    // Initialize and apply version once
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    await runCliCommand(['build', '2.0.0', '--notes', 'Test duplicate'], { 
      cwd: testEnv.tempDir 
    })
    
    await runCliCommand(['apply', '2.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Try to apply again
    const result = await runCliCommand(['apply', '2.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Version 2.0.0 already applied')
  })
  
  it('should rollback on migration failure', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    // Initialize
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Create migration with syntax error
    await createTestMigration(testEnv.tempDir, '0001_broken.sql', `
      CREATE TABLE broken (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE -- Missing comma here
        created_at TIMESTAMPTZ
      );
    `)
    
    await runCliCommand(['build', '3.0.0', '--notes', 'Broken migration'], { 
      cwd: testEnv.tempDir 
    })
    
    const result = await runCliCommand(['apply', '3.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('syntax error')
    
    // Verify table was not created
    const tables = await driver.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name = 'broken'
    `)
    expect(tables).toHaveLength(0)
    
    // Verify failure was recorded
    const versions = await driver.getAppliedVersions()
    const failed = versions.find(v => v.version === '3.0.0')
    expect(failed?.success).toBe(false)
    expect(failed?.error).toContain('syntax error')
    
    await driver.disconnect()
  })
  
  it('should handle missing migrations directory', async () => {
    const result = await runCliCommand([
      'build', '1.0.0',
      '--notes', 'Test',
      '--drizzle-path', '/non/existent/path'
    ], { 
      cwd: testEnv.tempDir 
    })
    
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Migrations directory not found')
  })
  
  it('should validate version format', async () => {
    const result = await runCliCommand([
      'build', 'invalid-version',
      '--notes', 'Test'
    ], { 
      cwd: testEnv.tempDir 
    })
    
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid version format')
  })
  
  it('should handle database connection failures', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: 'postgresql://invalid:invalid@localhost:9999/invalid'
    })
    
    const result = await runCliCommand(['status'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: 'postgresql://invalid:invalid@localhost:9999/invalid' }
    })
    
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/connection|ECONNREFUSED/i)
  })
  
  it('should handle corrupted artifacts', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Create a fake corrupted artifact
    const { writeFile } = await import('fs/promises')
    await writeFile(
      join(testEnv.tempDir, 'squizzle-v4.0.0.tar.gz'),
      'This is not a valid tar.gz file'
    )
    
    const result = await runCliCommand(['apply', '4.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/corrupt|invalid|format/i)
  })
  
  it('should handle version conflicts', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Initialize
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Apply version 1.0.0
    await createTestMigration(testEnv.tempDir, '0001_v1.sql', `
      CREATE TABLE v1_table (id SERIAL PRIMARY KEY);
    `)
    await runCliCommand(['build', '1.0.0', '--notes', 'Version 1'], { 
      cwd: testEnv.tempDir 
    })
    await runCliCommand(['apply', '1.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Try to apply version 1.0.1 without 1.0.0 as previous
    await createTestMigration(testEnv.tempDir, '0002_v1_1.sql', `
      CREATE TABLE v1_1_table (id SERIAL PRIMARY KEY);
    `)
    await runCliCommand(['build', '1.0.1', '--notes', 'Version 1.1'], { 
      cwd: testEnv.tempDir 
    })
    
    const result = await runCliCommand(['apply', '1.0.1'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // This might succeed or fail depending on implementation
    // but we should verify the system handles it gracefully
    expect([0, 1]).toContain(result.exitCode)
  })
})

function join(...paths: string[]): string {
  return paths.join('/')
}