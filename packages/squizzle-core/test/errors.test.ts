import { describe, it, expect } from 'vitest'
import {
  SquizzleError,
  MigrationError,
  ChecksumError,
  VersionError,
  LockError,
  SecurityError,
  StorageError,
  DatabaseError
} from '../src/errors'

describe('Error Classes', () => {
  describe('SquizzleError', () => {
    it('should create base error with message and code', () => {
      const error = new SquizzleError('Something went wrong', 'GENERIC_ERROR')
      
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(SquizzleError)
      expect(error.message).toBe('Something went wrong')
      expect(error.code).toBe('GENERIC_ERROR')
      expect(error.name).toBe('SquizzleError')
      expect(error.details).toBeUndefined()
    })

    it('should include details when provided', () => {
      const details = { file: 'test.sql', line: 42 }
      const error = new SquizzleError('Parse error', 'PARSE_ERROR', details)
      
      expect(error.details).toEqual(details)
    })

    it('should have proper stack trace', () => {
      const error = new SquizzleError('Test error', 'TEST_ERROR')
      
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('SquizzleError')
      expect(error.stack).toContain('errors.test.ts')
    })

    it('should be catchable as Error', () => {
      const throwError = () => {
        throw new SquizzleError('Test', 'TEST')
      }

      expect(() => {
        try {
          throwError()
        } catch (e) {
          if (e instanceof Error) {
            expect(e.message).toBe('Test')
          } else {
            throw new Error('Should be Error instance')
          }
        }
      }).not.toThrow()
    })
  })

  describe('MigrationError', () => {
    it('should create migration error with correct code', () => {
      const error = new MigrationError('Migration failed')
      
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(SquizzleError)
      expect(error).toBeInstanceOf(MigrationError)
      expect(error.message).toBe('Migration failed')
      expect(error.code).toBe('MIGRATION_ERROR')
      expect(error.name).toBe('MigrationError')
    })

    it('should include migration details', () => {
      const details = {
        migration: '0001_create_users.sql',
        reason: 'Syntax error',
        line: 5,
        column: 12
      }
      const error = new MigrationError('Failed to apply migration', details)
      
      expect(error.details).toEqual(details)
    })

    it('should handle errors without details', () => {
      const error = new MigrationError('Simple migration error')
      
      expect(error.details).toBeUndefined()
    })
  })

  describe('ChecksumError', () => {
    it('should create checksum error with correct code', () => {
      const error = new ChecksumError('Checksum mismatch')
      
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(SquizzleError)
      expect(error).toBeInstanceOf(ChecksumError)
      expect(error.message).toBe('Checksum mismatch')
      expect(error.code).toBe('CHECKSUM_ERROR')
      expect(error.name).toBe('ChecksumError')
    })

    it('should include checksum details', () => {
      const details = {
        expected: 'abc123',
        actual: 'def456',
        file: 'manifest.json'
      }
      const error = new ChecksumError('Integrity check failed', details)
      
      expect(error.details).toEqual(details)
    })
  })

  describe('VersionError', () => {
    it('should create version error with correct code', () => {
      const error = new VersionError('Invalid version')
      
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(SquizzleError)
      expect(error).toBeInstanceOf(VersionError)
      expect(error.message).toBe('Invalid version')
      expect(error.code).toBe('VERSION_ERROR')
      expect(error.name).toBe('VersionError')
    })

    it('should include version details', () => {
      const details = {
        version: '1.0.0',
        reason: 'Already applied',
        appliedAt: new Date('2024-01-01')
      }
      const error = new VersionError('Version already applied', details)
      
      expect(error.details).toEqual(details)
    })
  })

  describe('LockError', () => {
    it('should create lock error with correct code', () => {
      const error = new LockError('Could not acquire lock')
      
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(SquizzleError)
      expect(error).toBeInstanceOf(LockError)
      expect(error.message).toBe('Could not acquire lock')
      expect(error.code).toBe('LOCK_ERROR')
      expect(error.name).toBe('LockError')
    })

    it('should include lock details', () => {
      const details = {
        lockId: 'migration_lock',
        heldBy: 'process-123',
        timeout: 30000
      }
      const error = new LockError('Lock acquisition timeout', details)
      
      expect(error.details).toEqual(details)
    })
  })

  describe('SecurityError', () => {
    it('should create security error with correct code', () => {
      const error = new SecurityError('Signature verification failed')
      
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(SquizzleError)
      expect(error).toBeInstanceOf(SecurityError)
      expect(error.message).toBe('Signature verification failed')
      expect(error.code).toBe('SECURITY_ERROR')
      expect(error.name).toBe('SecurityError')
    })

    it('should include security details', () => {
      const details = {
        algorithm: 'RS256',
        keyId: 'key-123',
        reason: 'Invalid signature'
      }
      const error = new SecurityError('Security check failed', details)
      
      expect(error.details).toEqual(details)
    })
  })

  describe('StorageError', () => {
    it('should create storage error with correct code', () => {
      const error = new StorageError('Storage unavailable')
      
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(SquizzleError)
      expect(error).toBeInstanceOf(StorageError)
      expect(error.message).toBe('Storage unavailable')
      expect(error.code).toBe('STORAGE_ERROR')
      expect(error.name).toBe('StorageError')
    })

    it('should include storage details', () => {
      const details = {
        operation: 'push',
        registry: 'localhost:5000',
        statusCode: 503
      }
      const error = new StorageError('Failed to push artifact', details)
      
      expect(error.details).toEqual(details)
    })
  })

  describe('DatabaseError', () => {
    it('should create database error with correct code', () => {
      const error = new DatabaseError('Connection failed')
      
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(SquizzleError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.message).toBe('Connection failed')
      expect(error.code).toBe('DATABASE_ERROR')
      expect(error.name).toBe('DatabaseError')
    })

    it('should include database details', () => {
      const details = {
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        errno: 'ECONNREFUSED'
      }
      const error = new DatabaseError('Could not connect to database', details)
      
      expect(error.details).toEqual(details)
    })
  })

  describe('Error hierarchies and instanceof checks', () => {
    it('should maintain proper inheritance chain', () => {
      const errors = [
        new MigrationError('test'),
        new ChecksumError('test'),
        new VersionError('test'),
        new LockError('test'),
        new SecurityError('test'),
        new StorageError('test'),
        new DatabaseError('test')
      ]

      errors.forEach(error => {
        expect(error).toBeInstanceOf(Error)
        expect(error).toBeInstanceOf(SquizzleError)
      })
    })

    it('should allow catching specific error types', () => {
      const throwMigrationError = () => {
        throw new MigrationError('Migration failed')
      }

      expect(() => {
        try {
          throwMigrationError()
        } catch (e) {
          if (e instanceof MigrationError) {
            expect(e.code).toBe('MIGRATION_ERROR')
          } else {
            throw new Error('Should be MigrationError')
          }
        }
      }).not.toThrow()
    })

    it('should allow catching by base type', () => {
      const errors = [
        () => { throw new MigrationError('test') },
        () => { throw new ChecksumError('test') },
        () => { throw new VersionError('test') }
      ]

      errors.forEach(throwError => {
        expect(() => {
          try {
            throwError()
          } catch (e) {
            if (e instanceof SquizzleError) {
              expect(e.code).toBeDefined()
            } else {
              throw new Error('Should be SquizzleError')
            }
          }
        }).not.toThrow()
      })
    })
  })

  describe('Error serialization', () => {
    it('should serialize to JSON properly', () => {
      const error = new MigrationError('Test error', { 
        file: 'test.sql',
        line: 10 
      })

      const json = JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        details: error.details
      })

      const parsed = JSON.parse(json)
      expect(parsed).toEqual({
        name: 'MigrationError',
        message: 'Test error',
        code: 'MIGRATION_ERROR',
        details: { file: 'test.sql', line: 10 }
      })
    })

    it('should handle circular references in details', () => {
      const details: any = { prop: 'value' }
      details.circular = details

      const error = new SquizzleError('Test', 'TEST', details)
      
      expect(() => {
        // This would normally throw with circular reference
        // but the error itself should be constructable
        error.details.circular
      }).not.toThrow()
    })
  })

  describe('Error context enrichment', () => {
    it('should allow adding context to errors', () => {
      const originalError = new Error('Database connection failed')
      const details = {
        originalError: originalError.message,
        stack: originalError.stack,
        timestamp: new Date().toISOString(),
        context: {
          operation: 'apply',
          version: '1.0.0'
        }
      }

      const wrappedError = new DatabaseError('Failed to apply version', details)
      
      expect(wrappedError.details.originalError).toBe('Database connection failed')
      expect(wrappedError.details.context).toEqual({
        operation: 'apply',
        version: '1.0.0'
      })
    })
  })
})