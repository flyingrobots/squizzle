import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createManifest, ManifestOptions } from '../src/manifest'
import { Version } from '../src/types'
import { createHash } from 'crypto'

describe('createManifest', () => {
  let baseOptions: ManifestOptions

  beforeEach(() => {
    // Mock date and platform info for consistent tests
    vi.setSystemTime(new Date('2024-01-01T10:00:00Z'))
    
    baseOptions = {
      version: '1.0.0' as Version,
      drizzleKit: '0.25.0',
      files: [
        {
          path: 'drizzle/0001_init.sql',
          content: Buffer.from('CREATE TABLE users (id SERIAL PRIMARY KEY);'),
          type: 'drizzle' as const
        }
      ]
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic manifest creation', () => {
    it('should create a valid manifest with required fields', () => {
      const manifest = createManifest(baseOptions)

      expect(manifest.version).toBe('1.0.0')
      expect(manifest.drizzleKit).toBe('0.25.0')
      expect(manifest.created).toBe('2024-01-01T10:00:00.000Z')
      expect(manifest.engineVersion).toBe('2.0.0')
      expect(manifest.checksumAlgorithm).toBe('sha256')
      expect(manifest.files).toHaveLength(1)
    })

    it('should include platform information', () => {
      const manifest = createManifest(baseOptions)

      expect(manifest.platform).toEqual({
        os: process.platform,
        arch: process.arch,
        node: process.version
      })
    })

    it('should initialize with empty dependencies', () => {
      const manifest = createManifest(baseOptions)

      expect(manifest.dependencies).toEqual([])
    })

    it('should handle null previousVersion', () => {
      const manifest = createManifest(baseOptions)

      expect(manifest.previousVersion).toBeNull()
    })
  })

  describe('file processing', () => {
    it('should calculate checksums for each file', () => {
      const content = 'CREATE TABLE test();'
      const expectedChecksum = createHash('sha256').update(content).digest('hex')

      const manifest = createManifest({
        ...baseOptions,
        files: [{
          path: 'test.sql',
          content: Buffer.from(content),
          type: 'custom' as const
        }]
      })

      expect(manifest.files[0].checksum).toBe(expectedChecksum)
    })

    it('should record file sizes correctly', () => {
      const content = 'CREATE TABLE users (id INT, name VARCHAR(255));'
      const manifest = createManifest({
        ...baseOptions,
        files: [{
          path: 'test.sql',
          content: Buffer.from(content),
          type: 'drizzle' as const
        }]
      })

      expect(manifest.files[0].size).toBe(Buffer.byteLength(content))
    })

    it('should preserve file types', () => {
      const manifest = createManifest({
        ...baseOptions,
        files: [
          {
            path: 'drizzle/0001.sql',
            content: Buffer.from('-- drizzle'),
            type: 'drizzle' as const
          },
          {
            path: 'custom/function.sql',
            content: Buffer.from('-- custom'),
            type: 'custom' as const
          },
          {
            path: 'seed/data.sql',
            content: Buffer.from('-- seed'),
            type: 'seed' as const
          },
          {
            path: 'rollback/undo.sql',
            content: Buffer.from('-- rollback'),
            type: 'rollback' as const
          }
        ]
      })

      expect(manifest.files[0].type).toBe('drizzle')
      expect(manifest.files[1].type).toBe('custom')
      expect(manifest.files[2].type).toBe('seed')
      expect(manifest.files[3].type).toBe('rollback')
    })

    it('should handle empty files', () => {
      const manifest = createManifest({
        ...baseOptions,
        files: [{
          path: 'empty.sql',
          content: Buffer.from(''),
          type: 'custom' as const
        }]
      })

      expect(manifest.files[0].size).toBe(0)
      expect(manifest.files[0].checksum).toBe(
        createHash('sha256').update('').digest('hex')
      )
    })

    it('should handle multiple files', () => {
      const files = [
        {
          path: 'migrations/001.sql',
          content: Buffer.from('CREATE TABLE a();'),
          type: 'drizzle' as const
        },
        {
          path: 'migrations/002.sql',
          content: Buffer.from('CREATE TABLE b();'),
          type: 'drizzle' as const
        },
        {
          path: 'migrations/003.sql',
          content: Buffer.from('CREATE TABLE c();'),
          type: 'drizzle' as const
        }
      ]

      const manifest = createManifest({
        ...baseOptions,
        files
      })

      expect(manifest.files).toHaveLength(3)
      manifest.files.forEach((file, index) => {
        expect(file.path).toBe(files[index].path)
      })
    })

    it('should handle binary content', () => {
      const binaryContent = Buffer.from([0x00, 0xFF, 0x80, 0x7F])
      const manifest = createManifest({
        ...baseOptions,
        files: [{
          path: 'binary.dat',
          content: binaryContent,
          type: 'custom' as const
        }]
      })

      expect(manifest.files[0].size).toBe(4)
      expect(manifest.files[0].checksum).toBe(
        createHash('sha256').update(binaryContent).digest('hex')
      )
    })
  })

  describe('manifest checksum calculation', () => {
    it('should calculate overall checksum based on sorted files', () => {
      const files = [
        {
          path: 'b.sql',
          content: Buffer.from('B'),
          type: 'custom' as const
        },
        {
          path: 'a.sql',
          content: Buffer.from('A'),
          type: 'custom' as const
        }
      ]

      const manifest = createManifest({
        ...baseOptions,
        files
      })

      // Verify checksum is consistent regardless of input order
      const reversedManifest = createManifest({
        ...baseOptions,
        files: files.reverse()
      })

      expect(manifest.checksum).toBe(reversedManifest.checksum)
    })

    it('should produce different checksums for different files', () => {
      const manifest1 = createManifest({
        ...baseOptions,
        files: [{
          path: 'test.sql',
          content: Buffer.from('CREATE TABLE a();'),
          type: 'custom' as const
        }]
      })

      const manifest2 = createManifest({
        ...baseOptions,
        files: [{
          path: 'test.sql',
          content: Buffer.from('CREATE TABLE b();'),
          type: 'custom' as const
        }]
      })

      expect(manifest1.checksum).not.toBe(manifest2.checksum)
    })

    it('should include file paths in checksum calculation', () => {
      const content = Buffer.from('SAME CONTENT')
      
      const manifest1 = createManifest({
        ...baseOptions,
        files: [{
          path: 'path1.sql',
          content,
          type: 'custom' as const
        }]
      })

      const manifest2 = createManifest({
        ...baseOptions,
        files: [{
          path: 'path2.sql',
          content,
          type: 'custom' as const
        }]
      })

      expect(manifest1.checksum).not.toBe(manifest2.checksum)
    })
  })

  describe('optional fields', () => {
    it('should include notes when provided', () => {
      const manifest = createManifest({
        ...baseOptions,
        notes: 'Initial database schema'
      })

      expect(manifest.notes).toBe('Initial database schema')
    })

    it('should default notes to empty string', () => {
      const manifest = createManifest(baseOptions)

      expect(manifest.notes).toBe('')
    })

    it('should include author when provided', () => {
      const manifest = createManifest({
        ...baseOptions,
        author: 'test-user'
      })

      expect(manifest.author).toBe('test-user')
    })

    it('should allow undefined author', () => {
      const manifest = createManifest(baseOptions)

      expect(manifest.author).toBeUndefined()
    })

    it('should include previousVersion when provided', () => {
      const manifest = createManifest({
        ...baseOptions,
        previousVersion: '0.9.0' as Version
      })

      expect(manifest.previousVersion).toBe('0.9.0')
    })
  })

  describe('version handling', () => {
    it('should accept various version formats', () => {
      const versions = [
        '1.0.0',
        '2.1.0',
        '0.0.1',
        '10.20.30',
        '1.0.0-beta.1',
        '2.0.0-rc.2'
      ]

      versions.forEach(version => {
        const manifest = createManifest({
          ...baseOptions,
          version: version as Version
        })

        expect(manifest.version).toBe(version)
      })
    })
  })

  describe('validation', () => {
    it('should validate manifest schema', () => {
      // This test ensures ManifestSchema.parse is called
      // If validation fails, it will throw
      expect(() => createManifest(baseOptions)).not.toThrow()
    })

    it('should handle complex file structures', () => {
      const manifest = createManifest({
        ...baseOptions,
        files: [
          {
            path: 'drizzle/0001_initial.sql',
            content: Buffer.from('CREATE SCHEMA app;'),
            type: 'drizzle' as const
          },
          {
            path: 'custom/functions/uuid.sql',
            content: Buffer.from('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'),
            type: 'custom' as const
          },
          {
            path: 'seed/dev/users.sql',
            content: Buffer.from('INSERT INTO users VALUES (1, "admin");'),
            type: 'seed' as const
          }
        ]
      })

      expect(manifest.files).toHaveLength(3)
      expect(manifest.files.map(f => f.path)).toEqual([
        'drizzle/0001_initial.sql',
        'custom/functions/uuid.sql',
        'seed/dev/users.sql'
      ])
    })
  })

  describe('metadata', () => {
    it('should always use sha256 as checksum algorithm', () => {
      const manifest = createManifest(baseOptions)
      expect(manifest.checksumAlgorithm).toBe('sha256')
    })

    it('should set engine version to 2.0.0', () => {
      const manifest = createManifest(baseOptions)
      expect(manifest.engineVersion).toBe('2.0.0')
    })

    it('should use ISO string for created timestamp', () => {
      const manifest = createManifest(baseOptions)
      expect(manifest.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })
})