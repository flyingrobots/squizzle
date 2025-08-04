import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildCommand } from '../../src/commands/build'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { mkdtemp } from 'fs/promises'
import { execSync } from 'child_process'
import { Version } from '@squizzle/core'

// Mock dependencies
vi.mock('child_process', () => ({
  execSync: vi.fn()
}))

vi.mock('ora', () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    text: '',
    succeed: vi.fn(),
    fail: vi.fn()
  })
}))

vi.mock('../ui/banner', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn()
}))

// Mock config validator and version check
vi.mock('@squizzle/core', async () => {
  const actual = await vi.importActual('@squizzle/core')
  return {
    ...actual,
    ConfigValidator: vi.fn().mockImplementation(() => ({
      validate: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] })
    })),
    checkToolVersions: vi.fn().mockResolvedValue({
      compatible: true,
      tools: []
    }),
    preBuildChecks: vi.fn().mockResolvedValue(undefined)
  }
})

// Intercept process.exit
const processExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit unexpectedly called with "${code}"`)
})

describe('Performance Tests', { timeout: 30000 }, () => {
  let testDir: string
  let originalCwd: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    testDir = await mkdtemp(join(tmpdir(), 'squizzle-performance-test-'))
    process.chdir(testDir)
    
    // Create test package.json
    await writeFile(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      dependencies: {
        'drizzle-kit': '0.25.0'
      }
    }))
    
    // Reset mocks and set default behavior
    vi.clearAllMocks()
    const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>
    mockExecSync.mockReturnValue('')
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    await rm(testDir, { recursive: true })
    vi.clearAllMocks()
  })

  describe('large artifact handling', () => {
    it('should build large artifacts quickly', async () => {
      const startTime = Date.now()
      
      // Create a reasonable number of migration files (not too large for CI)
      await mkdir(join(testDir, 'db/drizzle'), { recursive: true })
      await mkdir(join(testDir, 'db/squizzle'), { recursive: true })
      
      // Create 50 migration files with meaningful content
      for (let i = 1; i <= 50; i++) {
        const paddedNum = i.toString().padStart(4, '0')
        const migrationContent = `-- Migration ${paddedNum}
CREATE TABLE migration_${paddedNum}_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_migration_${paddedNum}_users_email ON migration_${paddedNum}_users(email);
CREATE INDEX idx_migration_${paddedNum}_users_created_at ON migration_${paddedNum}_users(created_at);

INSERT INTO migration_${paddedNum}_users (email) VALUES ('user${paddedNum}@example.com');
`
        await writeFile(join(testDir, `db/drizzle/${paddedNum}_create_migration_${paddedNum}.sql`), migrationContent)
      }
      
      // Create some custom migrations
      for (let i = 1; i <= 10; i++) {
        const customContent = `-- Custom migration ${i}
CREATE OR REPLACE FUNCTION custom_function_${i}()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_custom_${i}
  BEFORE UPDATE ON migration_${i.toString().padStart(4, '0')}_users
  FOR EACH ROW
  EXECUTE FUNCTION custom_function_${i}();
`
        await writeFile(join(testDir, `db/squizzle/custom_${i}.sql`), customContent)
      }

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      // Build should complete within reasonable time
      await buildCommand('1.0.0' as Version, { config: mockConfig })
      
      const endTime = Date.now()
      const buildTime = endTime - startTime
      
      // Should complete within 10 seconds even with 60 files
      expect(buildTime).toBeLessThan(10000)
      
      // Should create the artifact
      expect(existsSync(join(testDir, 'db/tarballs/squizzle-v1.0.0.tar.gz'))).toBe(true)
      
      // Should not call process.exit
      expect(processExit).not.toHaveBeenCalled()
    })

    it('should handle artifacts approaching size limits', async () => {
      const startTime = Date.now()
      
      await mkdir(join(testDir, 'db/drizzle'), { recursive: true })
      
      // Create a single large migration file (1MB worth of SQL)
      const largeSqlStatements = []
      for (let i = 1; i <= 1000; i++) {
        largeSqlStatements.push(`
-- Table creation ${i}
CREATE TABLE IF NOT EXISTS large_table_${i} (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL DEFAULT 'default_name_${i}',
  description TEXT DEFAULT 'This is a default description for table ${i} that contains enough text to make the migration file larger and test performance with substantial content.',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{"type": "generated", "table_number": ${i}, "purpose": "performance_testing"}'
);

CREATE INDEX IF NOT EXISTS idx_large_table_${i}_uuid ON large_table_${i}(uuid);
CREATE INDEX IF NOT EXISTS idx_large_table_${i}_name ON large_table_${i}(name);
CREATE INDEX IF NOT EXISTS idx_large_table_${i}_created_at ON large_table_${i}(created_at);

INSERT INTO large_table_${i} (name, description) VALUES 
  ('test_${i}_1', 'Test record 1 for table ${i}'),
  ('test_${i}_2', 'Test record 2 for table ${i}'),
  ('test_${i}_3', 'Test record 3 for table ${i}');
`)
      }
      
      await writeFile(join(testDir, 'db/drizzle/0001_large_migration.sql'), largeSqlStatements.join('\n'))

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })
      
      const endTime = Date.now()
      const buildTime = endTime - startTime
      
      // Should still complete within reasonable time even with large files
      expect(buildTime).toBeLessThan(15000) // 15 seconds for large artifacts
      
      expect(existsSync(join(testDir, 'db/tarballs/squizzle-v1.0.0.tar.gz'))).toBe(true)
      expect(processExit).not.toHaveBeenCalled()
    })
  })

  describe('timeout handling', () => {
    it('should complete build operations within timeout limits', async () => {
      // Test with a moderate number of files to ensure consistent timing
      await mkdir(join(testDir, 'db/drizzle'), { recursive: true })
      
      for (let i = 1; i <= 20; i++) {
        const content = `CREATE TABLE test_${i} (id SERIAL PRIMARY KEY, name VARCHAR(255));`
        await writeFile(join(testDir, `db/drizzle/${i.toString().padStart(4, '0')}_test.sql`), content)
      }

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      // Use Promise.race to test timeout behavior
      const buildPromise = buildCommand('1.0.0' as Version, { config: mockConfig })
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Build operation timed out')), 5000) // 5 second timeout
      })

      // Should complete before timeout
      await expect(Promise.race([buildPromise, timeoutPromise])).resolves.toBeUndefined()
      
      expect(existsSync(join(testDir, 'db/tarballs/squizzle-v1.0.0.tar.gz'))).toBe(true)
    })

    it('should handle dry-run operations efficiently', async () => {
      const startTime = Date.now()
      
      await mkdir(join(testDir, 'db/drizzle'), { recursive: true })
      
      // Create files for dry-run testing
      for (let i = 1; i <= 30; i++) {
        const content = `CREATE TABLE dry_run_test_${i} (id SERIAL PRIMARY KEY);`
        await writeFile(join(testDir, `db/drizzle/${i.toString().padStart(4, '0')}_dry_run.sql`), content)
      }

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { 
        dryRun: true, 
        config: mockConfig 
      })
      
      const endTime = Date.now()
      const dryRunTime = endTime - startTime
      
      // Dry runs should be very fast since they don't create artifacts
      expect(dryRunTime).toBeLessThan(3000) // 3 seconds
      
      // Should not create any artifacts in dry-run mode
      expect(existsSync(join(testDir, 'db/tarballs'))).toBe(false)
    })
  })

  describe('memory efficiency', () => {
    it('should process files without excessive memory usage', async () => {
      // Test that the build can handle multiple files without memory issues
      await mkdir(join(testDir, 'db/drizzle'), { recursive: true })
      await mkdir(join(testDir, 'db/squizzle'), { recursive: true })
      
      // Create a reasonable number of varied files
      for (let i = 1; i <= 25; i++) {
        // Drizzle migrations
        await writeFile(
          join(testDir, `db/drizzle/${i.toString().padStart(4, '0')}_migration.sql`),
          `CREATE TABLE mem_test_${i} (id SERIAL PRIMARY KEY, data TEXT);`
        )
        
        // Custom migrations
        await writeFile(
          join(testDir, `db/squizzle/custom_${i}.sql`),
          `CREATE FUNCTION mem_func_${i}() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;`
        )
        
        // Some rollback files
        if (i % 5 === 0) {
          await writeFile(
            join(testDir, `db/squizzle/rollback_mem_test_${i}.sql`),
            `DROP TABLE IF EXISTS mem_test_${i}; DROP FUNCTION IF EXISTS mem_func_${i}();`
          )
        }
      }

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      // Monitor memory usage (basic check)
      const initialMemory = process.memoryUsage().heapUsed
      
      await buildCommand('1.0.0' as Version, { config: mockConfig })
      
      const finalMemory = process.memoryUsage().heapUsed
      const memoryIncrease = finalMemory - initialMemory
      
      // Memory increase should be reasonable (less than 50MB for this test)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024)
      
      expect(existsSync(join(testDir, 'db/tarballs/squizzle-v1.0.0.tar.gz'))).toBe(true)
    })
  })
})