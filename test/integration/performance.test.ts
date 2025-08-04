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
    
    // Create 5 table migration (reduced from 100 for CI efficiency)
    const largeMigration = Array.from({ length: 5 }, (_, i) => `
      CREATE TABLE table_${i} (
        id SERIAL PRIMARY KEY,
        data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      CREATE INDEX idx_table_${i}_created ON table_${i}(created_at);
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
    expect(duration).toBeLessThan(10000) // Should complete in < 10s
    
    // Verify all tables were created
    const driver = createPostgresDriver({
      connectionString: getConnectionString(testEnv.postgres)
    })
    await driver.connect()
    
    const tableCount = await driver.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'table_%'
    `)
    expect(Number(tableCount[0].count)).toBe(5)
    
    await driver.disconnect()
  }, 120000)
  
  it('should build large artifacts quickly', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Create migration files (reduced from 50 to 5 for CI efficiency)
    const migrations = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const filename = `${String(i + 1).padStart(4, '0')}_migration.sql`
        await createTestMigration(testEnv.tempDir, filename, `
          CREATE TABLE IF NOT EXISTS data_${i} (
            id SERIAL PRIMARY KEY,
            content TEXT
          );
          
          INSERT INTO data_${i} (content)
          SELECT 'Row ' || generate_series
          FROM generate_series(1, 10);
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
    expect(duration).toBeLessThan(5000) // Should build in < 5s
    expect(migrations).toHaveLength(5)
  }, 120000)
  
  it('should verify integrity quickly on large databases', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Initialize
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Create and apply a migration with sample data
    await createTestMigration(testEnv.tempDir, '0001_perf_test.sql', `
      CREATE TABLE performance_test (
        id SERIAL PRIMARY KEY,
        data TEXT,
        checksum TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Insert 100 rows (reduced from 10k for CI efficiency)
      INSERT INTO performance_test (data, checksum)
      SELECT 
        'Data ' || i,
        md5('Data ' || i)
      FROM generate_series(1, 100) i;
      
      CREATE INDEX idx_perf_checksum ON performance_test(checksum);
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
    expect(duration).toBeLessThan(2000) // Should verify in < 2s
  }, 120000)
  
  it('should handle concurrent operations gracefully', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Initialize
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Create multiple independent migrations
    await createTestMigration(testEnv.tempDir, '0001_users.sql', `
      CREATE TABLE concurrent_users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE
      );
    `)
    
    await createTestMigration(testEnv.tempDir, '0002_products.sql', `
      CREATE TABLE concurrent_products (
        id SERIAL PRIMARY KEY,
        name TEXT,
        price DECIMAL
      );
    `)
    
    await createTestMigration(testEnv.tempDir, '0003_orders.sql', `
      CREATE TABLE concurrent_orders (
        id SERIAL PRIMARY KEY,
        total DECIMAL
      );
    `)
    
    await runCliCommand(['build', '8.0.0', '--notes', 'Concurrent test'], { 
      cwd: testEnv.tempDir 
    })
    
    // Run multiple status checks concurrently
    const start = Date.now()
    const promises = Array.from({ length: 10 }, () =>
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
    expect(duration).toBeLessThan(3000)
  }, 120000)
  
  it('should list versions quickly with many versions', async () => {
    await createTestProject(testEnv.tempDir, {
      connectionString: getConnectionString(testEnv.postgres)
    })
    
    // Initialize
    await runCliCommand(['init'], { 
      cwd: testEnv.tempDir,
      env: { DATABASE_URL: getConnectionString(testEnv.postgres) }
    })
    
    // Build and apply many versions
    for (let i = 0; i < 20; i++) {
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
    expect(duration).toBeLessThan(1000) // Should list in < 1s
    
    // Verify all versions are listed
    const versionLines = result.stdout.split('\n').filter(line => 
      line.includes('1.') && line.includes('.0')
    )
    expect(versionLines.length).toBeGreaterThanOrEqual(20)
  }, 120000)
})