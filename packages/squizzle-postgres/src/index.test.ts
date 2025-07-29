import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PostgresDriver, createPostgresDriver, PostgresDriverOptions } from './index'
import { DatabaseError, LockError, Version, Manifest } from '@squizzle/core'
import { Pool, PoolClient } from 'pg'

// Mock pg module
vi.mock('pg', () => ({
  Pool: vi.fn(),
  Client: vi.fn()
}))

// Mock advisory-lock
vi.mock('advisory-lock', () => ({
  default: vi.fn(() => () => ({
    tryLock: vi.fn().mockResolvedValue(() => Promise.resolve())
  }))
}))

describe('PostgresDriver', () => {
  let mockPool: any
  let mockClient: any
  let driver: PostgresDriver

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Setup mock client
    mockClient = {
      query: vi.fn(),
      release: vi.fn()
    }

    // Setup mock pool
    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
      options: {
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'testuser',
        password: 'testpass'
      }
    }

    // Mock Pool constructor
    const MockPool = Pool as unknown as jest.Mock
    MockPool.mockImplementation(() => mockPool)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create driver with connection string', () => {
      const options: PostgresDriverOptions = {
        connectionString: 'postgresql://user:pass@localhost:5432/db'
      }

      driver = new PostgresDriver(options)

      expect(Pool).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@localhost:5432/db'
      })
    })

    it('should create driver with individual options', () => {
      const options: PostgresDriverOptions = {
        host: 'dbhost',
        port: 5433,
        database: 'mydb',
        user: 'myuser',
        password: 'mypass',
        ssl: true,
        max: 20,
        idleTimeoutMillis: 60000,
        connectionTimeoutMillis: 5000
      }

      driver = new PostgresDriver(options)

      expect(Pool).toHaveBeenCalledWith({
        host: 'dbhost',
        port: 5433,
        database: 'mydb',
        user: 'myuser',
        password: 'mypass',
        ssl: true,
        max: 20,
        idleTimeoutMillis: 60000,
        connectionTimeoutMillis: 5000
      })
    })

    it('should use default values when options not provided', () => {
      driver = new PostgresDriver({})

      expect(Pool).toHaveBeenCalledWith({
        host: 'localhost',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: undefined,
        ssl: undefined,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
      })
    })

    it('should use provided pool if given', () => {
      const customPool = { custom: 'pool' } as any
      driver = new PostgresDriver({ pool: customPool })

      expect(Pool).not.toHaveBeenCalled()
    })

    it('should have correct driver name', () => {
      driver = new PostgresDriver({})
      expect(driver.name).toBe('postgres')
    })
  })

  describe('connect', () => {
    beforeEach(() => {
      driver = new PostgresDriver({})
    })

    it('should connect to the pool and ensure version table', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await driver.connect()

      expect(mockPool.connect).toHaveBeenCalled()
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS squizzle.squizzle_versions'))
    })

    it('should throw DatabaseError on connection failure', async () => {
      mockPool.connect.mockRejectedValue(new Error('Connection failed'))

      await expect(driver.connect()).rejects.toThrow(DatabaseError)
      await expect(driver.connect()).rejects.toThrow('Failed to connect: Error: Connection failed')
    })

    it('should create indexes on version table', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await driver.connect()

      const createTableCall = mockClient.query.mock.calls[0][0]
      expect(createTableCall).toContain('CREATE INDEX IF NOT EXISTS idx_squizzle_versions_applied_at')
      expect(createTableCall).toContain('CREATE INDEX IF NOT EXISTS idx_squizzle_versions_success')
      expect(createTableCall).toContain('CREATE SCHEMA IF NOT EXISTS squizzle')
    })
  })

  describe('disconnect', () => {
    beforeEach(async () => {
      driver = new PostgresDriver({})
      mockClient.query.mockResolvedValue({ rows: [] })
      await driver.connect()
    })

    it('should release client and end pool', async () => {
      await driver.disconnect()

      expect(mockClient.release).toHaveBeenCalled()
      expect(mockPool.end).toHaveBeenCalled()
    })

    it('should handle disconnect without connect', async () => {
      driver = new PostgresDriver({})
      
      await driver.disconnect()

      expect(mockPool.end).toHaveBeenCalled()
    })
  })

  describe('execute', () => {
    beforeEach(async () => {
      driver = new PostgresDriver({})
      mockClient.query.mockResolvedValue({ rows: [] })
      await driver.connect()
    })

    it('should execute SQL query', async () => {
      const sql = 'CREATE TABLE test (id INT)'
      await driver.execute(sql)

      expect(mockClient.query).toHaveBeenCalledWith(sql)
    })

    it('should throw DatabaseError on execution failure', async () => {
      mockClient.query.mockRejectedValue(new Error('Syntax error'))

      await expect(driver.execute('INVALID SQL')).rejects.toThrow(DatabaseError)
      await expect(driver.execute('INVALID SQL')).rejects.toThrow('Failed to execute SQL')
    })

    it('should use pool if no client connected', async () => {
      driver = new PostgresDriver({})
      mockPool.query.mockResolvedValue({ rows: [] })

      await driver.execute('SELECT 1')

      expect(mockPool.query).toHaveBeenCalledWith('SELECT 1')
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      driver = new PostgresDriver({})
      mockClient.query.mockResolvedValue({ rows: [] })
      await driver.connect()
    })

    it('should execute query and return rows', async () => {
      const mockRows = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' }
      ]
      mockClient.query.mockResolvedValue({ rows: mockRows })

      const result = await driver.query('SELECT * FROM users')

      expect(result).toEqual(mockRows)
      expect(mockClient.query).toHaveBeenCalledWith('SELECT * FROM users')
    })

    it('should handle empty results', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await driver.query('SELECT * FROM users WHERE 1=0')

      expect(result).toEqual([])
    })

    it('should throw DatabaseError on query failure', async () => {
      mockClient.query.mockRejectedValue(new Error('Table not found'))

      await expect(driver.query('SELECT * FROM nonexistent')).rejects.toThrow(DatabaseError)
      await expect(driver.query('SELECT * FROM nonexistent')).rejects.toThrow('Failed to query')
    })

    it('should support typed queries', async () => {
      interface User {
        id: number
        name: string
      }

      const mockRows: User[] = [{ id: 1, name: 'test' }]
      mockClient.query.mockResolvedValue({ rows: mockRows })

      const result = await driver.query<User>('SELECT * FROM users')

      expect(result).toEqual(mockRows)
      expect(result[0].id).toBe(1)
      expect(result[0].name).toBe('test')
    })
  })

  describe('transaction', () => {
    beforeEach(async () => {
      driver = new PostgresDriver({})
      mockClient.query.mockResolvedValue({ rows: [] })
    })

    it('should execute transaction successfully', async () => {
      const result = await driver.transaction(async (txDriver) => {
        await txDriver.execute('INSERT INTO test VALUES (1)')
        return 'success'
      })

      expect(result).toBe('success')
      expect(mockPool.connect).toHaveBeenCalled()
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith('INSERT INTO test VALUES (1)')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('should rollback on error', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('Insert failed')) // INSERT

      await expect(driver.transaction(async (txDriver) => {
        await txDriver.execute('INSERT INTO test VALUES (1)')
      })).rejects.toThrow('Insert failed')

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('should release client even on rollback failure', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('Insert failed')) // INSERT
        .mockRejectedValueOnce(new Error('Rollback failed')) // ROLLBACK

      await expect(driver.transaction(async (txDriver) => {
        await txDriver.execute('INSERT INTO test VALUES (1)')
      })).rejects.toThrow('Insert failed')

      expect(mockClient.release).toHaveBeenCalled()
    })

    it('should provide isolated transaction driver', async () => {
      let capturedDriver: any

      await driver.transaction(async (txDriver) => {
        capturedDriver = txDriver
        return null
      })

      expect(capturedDriver).toBeDefined()
      expect(capturedDriver).toBeInstanceOf(PostgresDriver)
    })
  })

  describe('getAppliedVersions', () => {
    beforeEach(async () => {
      driver = new PostgresDriver({})
      mockClient.query.mockResolvedValue({ rows: [] })
      await driver.connect()
    })

    it('should return applied versions', async () => {
      const mockVersions = [
        {
          version: '1.0.0',
          applied_at: new Date('2024-01-01'),
          applied_by: 'user1',
          checksum: 'abc123',
          success: true,
          error: null,
          rollback_of: null
        },
        {
          version: '1.0.1',
          applied_at: new Date('2024-01-02'),
          applied_by: 'user2',
          checksum: 'def456',
          success: false,
          error: 'Migration failed',
          rollback_of: '1.0.0'
        }
      ]

      mockClient.query.mockResolvedValue({ rows: mockVersions })

      const result = await driver.getAppliedVersions()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        version: '1.0.0',
        appliedAt: new Date('2024-01-01'),
        appliedBy: 'user1',
        checksum: 'abc123',
        success: true,
        error: undefined,
        rollbackOf: undefined
      })
      expect(result[1]).toEqual({
        version: '1.0.1',
        appliedAt: new Date('2024-01-02'),
        appliedBy: 'user2',
        checksum: 'def456',
        success: false,
        error: 'Migration failed',
        rollbackOf: '1.0.0'
      })
    })

    it('should order by applied_at DESC', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      await driver.getAppliedVersions()

      // Find the SELECT query (not the CREATE TABLE query)
      const selectQuery = mockClient.query.mock.calls.find(call => 
        call[0].includes('SELECT') && call[0].includes('FROM squizzle.squizzle_versions')
      )
      expect(selectQuery).toBeDefined()
      expect(selectQuery[0]).toContain('ORDER BY applied_at DESC')
    })

    it('should handle empty results', async () => {
      mockClient.query.mockResolvedValue({ rows: [] })

      const result = await driver.getAppliedVersions()

      expect(result).toEqual([])
    })
  })

  describe('recordVersion', () => {
    beforeEach(async () => {
      driver = new PostgresDriver({})
      mockClient.query.mockResolvedValue({ rows: [] })
      await driver.connect()
    })

    it('should record successful version', async () => {
      const manifest: Manifest = {
        version: '1.0.0' as Version,
        checksum: 'abc123',
        created: '2024-01-01T00:00:00Z',
        checksumAlgorithm: 'sha256',
        drizzleKit: '0.25.0',
        engineVersion: '2.0.0',
        notes: 'Test migration',
        author: 'testuser',
        files: [],
        dependencies: [],
        platform: { os: 'linux', arch: 'x64', node: 'v18.0.0' }
      }

      process.env.USER = 'testuser'
      await driver.recordVersion('1.0.0' as Version, manifest, true)

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO squizzle.squizzle_versions'),
        [
          '1.0.0',
          'abc123',
          'testuser',
          true,
          undefined,
          JSON.stringify(manifest)
        ]
      )
    })

    it('should record failed version with error', async () => {
      const manifest = {} as Manifest
      manifest.checksum = 'xyz789'

      await driver.recordVersion('1.0.1' as Version, manifest, false, 'Migration syntax error')

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          '1.0.1',
          'xyz789',
          expect.any(String),
          false,
          'Migration syntax error',
          expect.any(String)
        ])
      )
    })

    it('should use unknown user if USER env not set', async () => {
      delete process.env.USER
      const manifest = { checksum: 'test' } as Manifest

      await driver.recordVersion('1.0.0' as Version, manifest, true)

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['unknown'])
      )
    })
  })

  describe('lock', () => {
    beforeEach(() => {
      driver = new PostgresDriver({
        host: 'localhost',
        port: 5432,
        database: 'test',
        user: 'testuser',
        password: 'testpass'
      })
    })

    it('should acquire and release lock', async () => {
      const mockUnlock = vi.fn().mockResolvedValue(undefined)
      const mockTryLock = vi.fn().mockResolvedValue(mockUnlock)
      
      const advisoryLock = await import('advisory-lock')
      const mockAdvisoryLock = advisoryLock.default as unknown as jest.Mock
      mockAdvisoryLock.mockReturnValue(() => ({
        tryLock: mockTryLock
      }))

      const release = await driver.lock('migration_lock')

      expect(mockTryLock).toHaveBeenCalled()
      expect(release).toBeInstanceOf(Function)

      await release()
      expect(mockUnlock).toHaveBeenCalled()
    })

    it('should throw LockError if lock already held', async () => {
      const mockTryLock = vi.fn().mockResolvedValue(null)
      
      const advisoryLock = await import('advisory-lock')
      const mockAdvisoryLock = advisoryLock.default as unknown as jest.Mock
      mockAdvisoryLock.mockReturnValue(() => ({
        tryLock: mockTryLock
      }))

      await expect(driver.lock('busy_lock')).rejects.toThrow(LockError)
      await expect(driver.lock('busy_lock')).rejects.toThrow('Lock busy_lock is already held')
    })

    it('should use connection string if provided', async () => {
      driver = new PostgresDriver({
        connectionString: 'postgresql://user:pass@host:5432/db'
      })

      const advisoryLock = await import('advisory-lock')
      const mockAdvisoryLock = advisoryLock.default as unknown as jest.Mock
      mockAdvisoryLock.mockReturnValue(() => ({
        tryLock: vi.fn().mockResolvedValue(() => Promise.resolve())
      }))

      await driver.lock('test_lock')

      expect(mockAdvisoryLock).toHaveBeenCalledWith('postgresql://user:pass@host:5432/db')
    })

    it('should wrap other errors in LockError', async () => {
      const advisoryLock = await import('advisory-lock')
      const mockAdvisoryLock = advisoryLock.default as unknown as jest.Mock
      mockAdvisoryLock.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      await expect(driver.lock('error_lock')).rejects.toThrow(LockError)
      await expect(driver.lock('error_lock')).rejects.toThrow('Failed to acquire lock error_lock')
    })
  })

  describe('factory function', () => {
    it('should create PostgresDriver instance', () => {
      const options = { host: 'testhost' }
      const driver = createPostgresDriver(options)

      expect(driver).toBeInstanceOf(PostgresDriver)
      expect(driver.name).toBe('postgres')
    })
  })
})