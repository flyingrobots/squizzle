# @squizzle/core

Core engine and interfaces for SQUIZZLE - the immutable database migration system.

## Installation

```bash
npm install @squizzle/core
```

## Overview

This package provides the core functionality for SQUIZZLE:
- Migration engine for applying database changes
- Manifest generation and validation
- Version management and comparison
- Checksum verification
- Error handling and logging

## Key Components

### MigrationEngine

The main orchestrator for database migrations:

```typescript
import { MigrationEngine } from '@squizzle/core'
import { createPostgresDriver } from '@squizzle/postgres'
import { createOCIStorage } from '@squizzle/oci'

const engine = new MigrationEngine({
  driver: createPostgresDriver({ connectionString: DATABASE_URL }),
  storage: createOCIStorage({ registry: 'ghcr.io/myorg' }),
  logger: new Logger({ level: 'info' })
})

// Apply a migration
await engine.apply('1.0.0', {
  dryRun: false,
  force: false
})
```

### Manifest

Immutable metadata for each version:

```typescript
import { Manifest } from '@squizzle/core'

const manifest: Manifest = {
  version: '1.0.0',
  previousVersion: '0.9.0',
  created: new Date().toISOString(),
  checksum: 'sha256:...',
  files: [
    { path: '001_init.sql', checksum: 'sha256:...', size: 1024, type: 'drizzle' }
  ],
  notes: 'Initial schema',
  // ... other metadata
}
```

### Version Management

Semantic versioning with comparison utilities:

```typescript
import { Version, compareVersions } from '@squizzle/core'

const v1: Version = '1.0.0'
const v2: Version = '1.1.0'

if (compareVersions(v1, v2) < 0) {
  console.log(`${v1} is older than ${v2}`)
}
```

## Interfaces

### DatabaseDriver

Interface for database-specific implementations:

```typescript
interface DatabaseDriver {
  connect(): Promise<void>
  disconnect(): Promise<void>
  execute(sql: string): Promise<void>
  query<T>(sql: string): Promise<T[]>
  transaction<T>(fn: (client: DatabaseDriver) => Promise<T>): Promise<T>
  getAppliedVersions(): Promise<AppliedVersion[]>
  recordVersion(version: Version, manifest: Manifest, success: boolean): Promise<void>
  lock(key: string, timeout?: number): Promise<() => Promise<void>>
}
```

### ArtifactStorage

Interface for storing migration artifacts:

```typescript
interface ArtifactStorage {
  push(version: Version, artifact: Buffer, manifest: Manifest): Promise<string>
  pull(version: Version): Promise<{ artifact: Buffer; manifest: Manifest }>
  exists(version: Version): Promise<boolean>
  list(): Promise<Version[]>
  delete(version: Version): Promise<void>
  getManifest(version: Version): Promise<Manifest>
}
```

## Error Handling

Typed errors for better debugging:

```typescript
import { 
  MigrationError, 
  VersionError, 
  ChecksumError,
  LockError 
} from '@squizzle/core'

try {
  await engine.apply(version)
} catch (error) {
  if (error instanceof ChecksumError) {
    console.error('Artifact integrity check failed!')
  } else if (error instanceof LockError) {
    console.error('Another migration is in progress')
  }
}
```

## Logger

Built-in logger with levels:

```typescript
import { Logger } from '@squizzle/core'

const logger = new Logger({
  level: 'debug', // debug | info | warn | error
  prefix: '[SQUIZZLE]'
})

logger.info('Applying migration', { version: '1.0.0' })
logger.debug('SQL executed', { query: 'CREATE TABLE...' })
```

## License

MIT