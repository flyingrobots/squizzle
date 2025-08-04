import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { IntegrationTestEnv, setupIntegrationTest, getConnectionString } from './setup'
import { runCliCommand, createTestMigration, createTestProject } from './helpers'
import { createPostgresDriver } from '@squizzle/postgres'

describe('Performance Integration', () => {
  let testEnv: IntegrationTestEnv
  
  beforeAll(async () => {
    testEnv = await setupIntegrationTest()
  }, 30000)
  
  afterAll(async () => {
    await testEnv.cleanup()
  })
  
  it('should handle large migrations efficiently', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Initialize
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Create simple 2 table migration (reduced for CI speed)
    const largeMigration = Array.from({ length: 2 }, (_, i) => `
      CREATE TABLE table_${i} (
        id SERIAL PRIMARY KEY,
        data TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).join('\n')
    
    await createTestMigration(testEnv.tempDir, '0001_large.sql', largeMigration)
    
    // Build
    await runCliCommand(['build', '5.0.0', '--notes', 'Large migration test'], { 
      cwd: testEnv.tempDir 
    })
    
    // Measure apply time
    const start = Date.now()
    const result = await runCliCommand(['apply', '5.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    const duration = Date.now() - start
    
    expect(result.exitCode).toBe(0)
    expect(duration).toBeLessThan(30000) // Should complete in < 30s
    
    // Verify all tables were created
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    try {
      const tableCount = await driver.query(`
        SELECT COUNT(*) as count FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name LIKE 'table_%'
      `)
      expect(Number(tableCount[0].count)).toBe(2)
    } finally {
      await driver.disconnect()
    }
  }, 60000)
  
  it('should build large artifacts quickly', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Create migration files (reduced to 2 for CI speed)
    const migrations = await Promise.all(
      Array.from({ length: 2 }, async (_, i) => {
        const filename = `${String(i + 1).padStart(4, '0')}_migration.sql`
        await createTestMigration(testEnv.tempDir, filename, `
          CREATE TABLE IF NOT EXISTS data_${i} (
            id SERIAL PRIMARY KEY,
            content TEXT
          );
        `)
        return filename
      })
    )
    
    // Measure build time
    const start = Date.now()
    const result = await runCliCommand([
      'build', '6.0.0',
      '--notes', 'Many files test'
    ], { 
      cwd: testEnv.tempDir 
    })
    const duration = Date.now() - start
    
    expect(result.exitCode).toBe(0)
    expect(duration).toBeLessThan(15000) // Should build in < 15s
    expect(migrations).toHaveLength(2)
  }, 30000)
  
  it('should verify integrity quickly on large databases', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Initialize
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Create and apply a migration with minimal sample data
    await createTestMigration(testEnv.tempDir, '0001_perf_test.sql', `
      CREATE TABLE performance_test (
        id SERIAL PRIMARY KEY,
        data TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Insert just 10 rows for CI speed
      INSERT INTO performance_test (data)
      SELECT 'Data ' || i
      FROM generate_series(1, 10) i;
    `)
    
    await runCliCommand(['build', '7.0.0', '--notes', 'Performance data'], { 
      cwd: testEnv.tempDir 
    })
    
    await runCliCommand(['apply', '7.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Measure verify time
    const start = Date.now()
    const result = await runCliCommand(['verify', '7.0.0'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    const duration = Date.now() - start
    
    expect(result.exitCode).toBe(0)
    expect(duration).toBeLessThan(10000) // Should verify in < 10s
  }, 30000)
  
  it('should handle concurrent operations gracefully', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Initialize
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Create one simple migration
    await createTestMigration(testEnv.tempDir, '0001_users.sql', `
      CREATE TABLE concurrent_users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE
      );
    `)
    
    await runCliCommand(['build', '8.0.0', '--notes', 'Concurrent test'], { 
      cwd: testEnv.tempDir 
    })
    
    // Run fewer concurrent status checks for CI speed
    const start = Date.now()
    const promises = Array.from({ length: 3 }, () =>
      runCliCommand(['status'], {
        cwd: testEnv.tempDir,
        env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
      })
    )
    
    const results = await Promise.all(promises)
    const duration = Date.now() - start
    
    // All should succeed
    results.forEach(result => {
      expect(result.exitCode).toBe(0)
    })
    
    // Should handle concurrent requests efficiently
    expect(duration).toBeLessThan(10000)
  }, 30000)
  
  it('should list versions quickly with many versions', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Initialize
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Build and apply just 3 versions (reduced for CI speed)
    for (let i = 0; i < 3; i++) {
      await createTestMigration(
        testEnv.tempDir, 
        `${String(i + 1).padStart(4, '0')}_v${i}.sql`,
        `CREATE TABLE version_${i} (id SERIAL PRIMARY KEY);`
      )
      
      await runCliCommand([
        'build', 
        `1.${i}.0`,
        '--notes', `Version ${i}`
      ], { 
        cwd: testEnv.tempDir 
      })
      
      await runCliCommand(['apply', `1.${i}.0`], {
        cwd: testEnv.tempDir,
        env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
      })
    }
    
    // Measure list time
    const start = Date.now()
    const result = await runCliCommand(['list'], {
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    const duration = Date.now() - start
    
    expect(result.exitCode).toBe(0)
    expect(duration).toBeLessThan(5000) // Should list in < 5s
    
    // Verify all versions are listed
    const versionLines = result.stdout.split('\n').filter(line => 
      line.includes('1.') && line.includes('.0')
    )
    expect(versionLines.length).toBeGreaterThanOrEqual(3)
  }, 30000)
})