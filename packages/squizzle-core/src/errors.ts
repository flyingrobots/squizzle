export class SquizzleError extends Error {
  constructor(message: string, public code: string, public details?: any) {
    super(message)
    this.name = 'SquizzleError'
  }
}

export class MigrationError extends SquizzleError {
  constructor(message: string, details?: any) {
    super(message, 'MIGRATION_ERROR', details)
    this.name = 'MigrationError'
  }
}

export class ChecksumError extends SquizzleError {
  constructor(message: string, details?: any) {
    super(message, 'CHECKSUM_ERROR', details)
    this.name = 'ChecksumError'
  }
}

export class VersionError extends SquizzleError {
  constructor(message: string, details?: any) {
    super(message, 'VERSION_ERROR', details)
    this.name = 'VersionError'
  }
}

export class LockError extends SquizzleError {
  constructor(message: string, details?: any) {
    super(message, 'LOCK_ERROR', details)
    this.name = 'LockError'
  }
}

export class SecurityError extends SquizzleError {
  constructor(message: string, details?: any) {
    super(message, 'SECURITY_ERROR', details)
    this.name = 'SecurityError'
  }
}

export class StorageError extends SquizzleError {
  constructor(message: string, details?: any) {
    super(message, 'STORAGE_ERROR', details)
    this.name = 'StorageError'
  }
}

export class DatabaseError extends SquizzleError {
  constructor(message: string, details?: any) {
    super(message, 'DATABASE_ERROR', details)
    this.name = 'DatabaseError'
  }
}