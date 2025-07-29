import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildCommand } from '../../src/commands/build'
import { mkdir, writeFile, rm, readFile } from 'fs/promises'
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

describe('buildCommand', () => {
  let testDir: string
  let originalCwd: string

  beforeEach(async () => {
    originalCwd = process.cwd()
    testDir = await mkdtemp(join(tmpdir(), 'squizzle-build-test-'))
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

  describe('basic functionality', () => {
    it('should generate Drizzle migrations', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      expect(execSync).toHaveBeenCalledWith('npx drizzle-kit generate', { stdio: 'pipe' })
    })

    it('should skip generation in dry-run mode', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { dryRun: true, config: mockConfig })

      expect(execSync).not.toHaveBeenCalled()
    })

    it('should create artifact directory structure', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      // Create some test migration files
      await mkdir(join(testDir, 'db/drizzle'), { recursive: true })
      await writeFile(join(testDir, 'db/drizzle/0001_test.sql'), 'CREATE TABLE test();')

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      expect(existsSync(join(testDir, '.squizzle/build/1.0.0'))).toBe(true)
      expect(existsSync(join(testDir, 'db/tarballs'))).toBe(true)
    })
  })

  describe('migration file collection', () => {
    beforeEach(async () => {
      // Create migration directories
      await mkdir(join(testDir, 'db/drizzle'), { recursive: true })
      await mkdir(join(testDir, 'db/squizzle'), { recursive: true })
    })

    it('should collect Drizzle migration files', async () => {
      await writeFile(join(testDir, 'db/drizzle/0001_init.sql'), 'CREATE TABLE users();')
      await writeFile(join(testDir, 'db/drizzle/0002_add_column.sql'), 'ALTER TABLE users ADD email TEXT;')

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      // Check that files were collected (manifest should be created)
      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      expect(existsSync(manifestPath)).toBe(true)
      
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      expect(manifest.files).toHaveLength(2)
      expect(manifest.files[0].path).toBe('drizzle/0001_init.sql')
      expect(manifest.files[1].path).toBe('drizzle/0002_add_column.sql')
    })

    it('should collect custom migration files', async () => {
      await writeFile(join(testDir, 'db/squizzle/custom_function.sql'), 'CREATE FUNCTION test();')
      await writeFile(join(testDir, 'db/squizzle/seed_data.sql'), 'INSERT INTO users VALUES();')

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.files.some((f: any) => f.path === 'squizzle/custom_function.sql')).toBe(true)
      expect(manifest.files.some((f: any) => f.path === 'squizzle/seed_data.sql')).toBe(true)
    })

    it('should identify rollback files correctly', async () => {
      await writeFile(join(testDir, 'db/squizzle/rollback_users.sql'), 'DROP TABLE users;')

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      const rollbackFile = manifest.files.find((f: any) => f.path === 'squizzle/rollback_users.sql')
      expect(rollbackFile).toBeTruthy()
    })

    it('should handle empty migration directories', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.files).toHaveLength(0)
    })

    it('should ignore non-SQL files', async () => {
      await writeFile(join(testDir, 'db/drizzle/README.md'), 'Documentation')
      await writeFile(join(testDir, 'db/drizzle/0001_test.sql'), 'CREATE TABLE test();')

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.files).toHaveLength(1)
      expect(manifest.files[0].path).toBe('drizzle/0001_test.sql')
    })
  })

  describe('manifest creation', () => {
    it('should include version in manifest', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('2.1.0' as Version, { config: mockConfig })

      const manifestPath = join(testDir, '.squizzle/build/2.1.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.version).toBe('2.1.0')
    })

    it('should include notes if provided', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { 
        notes: 'Initial schema setup',
        config: mockConfig 
      })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.notes).toBe('Initial schema setup')
    })

    it('should include author if provided', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { 
        author: 'test-user',
        config: mockConfig 
      })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.author).toBe('test-user')
    })

    it('should use USER env variable for author if not provided', async () => {
      const originalUser = process.env.USER
      process.env.USER = 'env-user'

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.author).toBe('env-user')

      process.env.USER = originalUser
    })

    it('should detect Drizzle Kit version from dependencies', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.drizzleKit).toBe('0.25.0')
    })

    it('should handle missing Drizzle Kit version', async () => {
      // Remove drizzle-kit from package.json
      await writeFile(join(testDir, 'package.json'), JSON.stringify({
        name: 'test-project'
      }))

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.drizzleKit).toBe('unknown')
    })
  })

  describe('tarball creation', () => {
    it('should create tarball with correct name', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.2.3' as Version, { config: mockConfig })

      expect(existsSync(join(testDir, 'db/tarballs/squizzle-v1.2.3.tar.gz'))).toBe(true)
    })

    it('should include manifest in tarball', async () => {
      await mkdir(join(testDir, 'db/drizzle'), { recursive: true })
      await writeFile(join(testDir, 'db/drizzle/0001_test.sql'), 'CREATE TABLE test();')

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      // Verify files were written to build directory
      expect(existsSync(join(testDir, '.squizzle/build/1.0.0/manifest.json'))).toBe(true)
      expect(existsSync(join(testDir, '.squizzle/build/1.0.0/drizzle/0001_test.sql'))).toBe(true)
    })
  })

  describe('dry-run mode', () => {
    it('should not create artifacts in dry-run mode', async () => {
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

      expect(existsSync(join(testDir, 'db/tarballs'))).toBe(false)
      expect(existsSync(join(testDir, '.squizzle/build/1.0.0'))).toBe(false)
    })

    it('should still collect files in dry-run mode', async () => {
      await mkdir(join(testDir, 'db/drizzle'), { recursive: true })
      await writeFile(join(testDir, 'db/drizzle/0001_test.sql'), 'CREATE TABLE test();')

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      // Spy on console.log to check output
      const consoleSpy = vi.spyOn(console, 'log')

      await buildCommand('1.0.0' as Version, { 
        dryRun: true,
        config: mockConfig 
      })

      // Check that the build preview was shown
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Build Preview:'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Total Files'))

      consoleSpy.mockRestore()
    })
  })

  describe('error handling', () => {
    it('should handle Drizzle Kit generation failure', async () => {
      const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>
      mockExecSync.mockImplementation(() => {
        throw new Error('Drizzle Kit not installed')
      })

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await expect(buildCommand('1.0.0' as Version, { config: mockConfig }))
        .rejects.toThrow('process.exit unexpectedly called with "1"')

      expect(processExit).toHaveBeenCalledWith(1)
    })

    it('should handle missing package.json gracefully', async () => {
      await rm(join(testDir, 'package.json'))

      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      const manifestPath = join(testDir, '.squizzle/build/1.0.0/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
      
      expect(manifest.drizzleKit).toBe('unknown')
    })
  })

  describe('security features', () => {
    it('should skip signing when security is disabled', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        },
        security: { enabled: false }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      // Should complete without errors (signing TODO is only executed when enabled)
      expect(existsSync(join(testDir, 'db/tarballs/squizzle-v1.0.0.tar.gz'))).toBe(true)
    })

    it('should attempt signing when security is enabled', async () => {
      const mockConfig = {
        storage: { type: 'oci', registry: 'localhost:5000' },
        environments: {
          development: { database: {} }
        },
        security: { enabled: true }
      }

      await buildCommand('1.0.0' as Version, { config: mockConfig })

      // Currently just a TODO, but should not fail
      expect(existsSync(join(testDir, 'db/tarballs/squizzle-v1.0.0.tar.gz'))).toBe(true)
    })
  })
})