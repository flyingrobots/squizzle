# API Reference

Programmatic API for SQUIZZLE when using it as a library.

## Installation

```bash
npm install @squizzle/core @squizzle/postgres
```

## Basic Usage

```typescript
import { MigrationEngine } from '@squizzle/core'
import { PostgresDriver } from '@squizzle/postgres'
import { OCIStorage } from '@squizzle/oci'
import { SigstoreProvider } from '@squizzle/security'

// Create engine instance
const engine = new MigrationEngine({
  driver: new PostgresDriver({
    connectionString: process.env.DATABASE_URL
  }),
  storage: new OCIStorage({
    registry: 'ghcr.io',
    repository: 'myorg/migrations'
  }),
  security: new SigstoreProvider()
})

// Apply migration
await engine.apply('1.0.0')
```

## Core API

### MigrationEngine

The main class for managing migrations.

```typescript
class MigrationEngine {
  constructor(options: EngineOptions)
  
  // Apply a version
  apply(version: Version, options?: MigrationOptions): Promise<void>
  
  // Rollback a version
  rollback(version: Version, options?: MigrationOptions): Promise<void>
  
  // Get status
  status(): Promise<{
    current: Version | null
    applied: AppliedVersion[]
    available: Version[]
  }>
  
  // Verify a version
  verify(version: Version): Promise<{
    valid: boolean
    errors: string[]
  }>
  
  // Build a version
  build(version: Version, options: BuildOptions): Promise<void>
  
  // List versions
  list(options?: ListOptions): Promise<Version[]>
  
  // Compare versions
  diff(from: Version, to: Version): Promise<VersionDiff>
}
```

### Types

```typescript
// Version string following semver
type Version = string

// Engine configuration
interface EngineOptions {
  driver: DatabaseDriver
  storage: ArtifactStorage
  security?: SecurityProvider
  logger?: Logger
}

// Migration options
interface MigrationOptions {
  dryRun?: boolean
  force?: boolean
  timeout?: number
  parallel?: boolean
  maxParallel?: number
  stopOnError?: boolean
  beforeEach?: (file: string) => Promise<void>
  afterEach?: (file: string, success: boolean) => Promise<void>
}

// Build options
interface BuildOptions {
  notes: string
  author?: string
  tags?: string[]
  sign?: boolean
  paths?: {
    drizzle?: string
    custom?: string
    rollback?: string
  }
}

// Applied version record
interface AppliedVersion {
  version: Version
  appliedAt: Date
  appliedBy: string
  checksum: string
  success: boolean
  error?: string
  rollbackOf?: Version
}
```

## Database Drivers

### PostgresDriver

```typescript
import { PostgresDriver } from '@squizzle/postgres'

const driver = new PostgresDriver({
  connectionString: 'postgresql://...',
  // or
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'user',
  password: 'pass',
  
  // Pool options
  max: 20,
  idleTimeoutMillis: 30000,
  
  // SSL options
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('ca-cert.pem')
  }
})

// Methods
await driver.connect()
await driver.disconnect()
await driver.execute('CREATE TABLE ...')
const rows = await driver.query('SELECT * FROM ...')

// Transaction
await driver.transaction(async (tx) => {
  await tx.execute('INSERT ...')
  await tx.execute('UPDATE ...')
})

// Locking
const unlock = await driver.lock('migration-lock')
try {
  // Do work
} finally {
  await unlock()
}
```

### Custom Database Driver

Implement the `DatabaseDriver` interface:

```typescript
import { DatabaseDriver, Version, Manifest, AppliedVersion } from '@squizzle/core'

class CustomDriver implements DatabaseDriver {
  name = 'custom'
  
  async connect(): Promise<void> {
    // Connect to database
  }
  
  async disconnect(): Promise<void> {
    // Disconnect
  }
  
  async execute(sql: string): Promise<void> {
    // Execute SQL
  }
  
  async query<T = any>(sql: string): Promise<T[]> {
    // Query and return results
  }
  
  async transaction<T>(fn: (client: DatabaseDriver) => Promise<T>): Promise<T> {
    // Run in transaction
  }
  
  async getAppliedVersions(): Promise<AppliedVersion[]> {
    // Get migration history
  }
  
  async recordVersion(
    version: Version,
    manifest: Manifest,
    success: boolean,
    error?: string
  ): Promise<void> {
    // Record migration
  }
  
  async lock(key: string, timeout?: number): Promise<() => Promise<void>> {
    // Acquire lock and return unlock function
  }
}
```

## Storage Backends

### OCIStorage

```typescript
import { OCIStorage } from '@squizzle/oci'

const storage = new OCIStorage({
  registry: 'ghcr.io',
  repository: 'myorg/migrations',
  auth: {
    username: process.env.GITHUB_USER,
    password: process.env.GITHUB_TOKEN
  }
})

// Methods
await storage.push('1.0.0', artifactBuffer, manifest)
const { artifact, manifest } = await storage.pull('1.0.0')
const exists = await storage.exists('1.0.0')
const versions = await storage.list()
await storage.delete('1.0.0')
const manifest = await storage.getManifest('1.0.0')
```

### Custom Storage Backend

Implement the `ArtifactStorage` interface:

```typescript
import { ArtifactStorage, Version, Manifest } from '@squizzle/core'

class CustomStorage implements ArtifactStorage {
  async push(
    version: Version,
    artifact: Buffer,
    manifest: Manifest
  ): Promise<string> {
    // Store artifact and return URL/ID
  }
  
  async pull(version: Version): Promise<{
    artifact: Buffer
    manifest: Manifest
  }> {
    // Retrieve artifact and manifest
  }
  
  async exists(version: Version): Promise<boolean> {
    // Check if version exists
  }
  
  async list(): Promise<Version[]> {
    // List all versions
  }
  
  async delete(version: Version): Promise<void> {
    // Delete version
  }
  
  async getManifest(version: Version): Promise<Manifest> {
    // Get manifest only
  }
}
```

## Security Providers

### SigstoreProvider

```typescript
import { SigstoreProvider } from '@squizzle/security'

const security = new SigstoreProvider({
  fulcio: 'https://fulcio.sigstore.dev',
  rekor: 'https://rekor.sigstore.dev'
})

// Sign artifact
const signature = await security.sign(artifactBuffer)

// Verify signature
const valid = await security.verify(artifactBuffer, signature)

// Generate SLSA provenance
const slsa = await security.generateSLSA(manifest, {
  builderId: 'https://github.com/org/repo/.github/workflows/build.yml',
  buildType: 'https://squizzle.dev/build/v1',
  invocation: { /* ... */ },
  materials: [ /* ... */ ]
})
```

### Custom Security Provider

```typescript
import { SecurityProvider, Manifest } from '@squizzle/core'

class CustomSecurityProvider implements SecurityProvider {
  async sign(data: Buffer): Promise<string> {
    // Sign data and return signature
  }
  
  async verify(data: Buffer, signature: string): Promise<boolean> {
    // Verify signature
  }
  
  async generateSLSA(
    manifest: Manifest,
    buildInfo: any
  ): Promise<Manifest['slsa']> {
    // Generate SLSA provenance
  }
}
```

## Logging

### Default Logger

```typescript
import { Logger } from '@squizzle/core'

const logger = new Logger({
  level: 'info', // debug, info, warn, error
  color: true,
  timestamp: true
})

// Usage
logger.debug('Debug message')
logger.info('Info message')
logger.warn('Warning message')
logger.error('Error message', error)
```

### Custom Logger

```typescript
import { Logger, LogLevel } from '@squizzle/core'

class CustomLogger extends Logger {
  log(level: LogLevel, message: string, data?: any): void {
    // Custom logging implementation
    console.log(`[${level}] ${message}`, data)
  }
}

const engine = new MigrationEngine({
  // ...
  logger: new CustomLogger()
})
```

## Error Handling

### Error Types

```typescript
import {
  MigrationError,
  ChecksumError,
  VersionError,
  SecurityError,
  ConnectionError,
  LockError
} from '@squizzle/core'

try {
  await engine.apply('1.0.0')
} catch (error) {
  if (error instanceof ChecksumError) {
    console.error('Integrity check failed:', error.message)
  } else if (error instanceof VersionError) {
    console.error('Version conflict:', error.message)
  } else if (error instanceof SecurityError) {
    console.error('Security violation:', error.message)
  } else if (error instanceof ConnectionError) {
    console.error('Database connection failed:', error.message)
  } else if (error instanceof LockError) {
    console.error('Could not acquire lock:', error.message)
  } else if (error instanceof MigrationError) {
    console.error('Migration failed:', error.message)
    console.error('Failed migration:', error.data?.migration)
  }
}
```

### Custom Error Handling

```typescript
const engine = new MigrationEngine({
  // ...
  onError: async (error, context) => {
    // Log to external service
    await logService.error({
      error: error.message,
      stack: error.stack,
      context: {
        version: context.version,
        file: context.file,
        operation: context.operation
      }
    })
    
    // Notify team
    if (error instanceof SecurityError) {
      await notifySecurityTeam(error)
    }
  }
})
```

## Advanced Usage

### Parallel Migrations

```typescript
await engine.apply('1.0.0', {
  parallel: true,
  maxParallel: 5,
  // Only parallelize independent migrations
  canParallelize: (fileA, fileB) => {
    // Custom logic to determine if files can run in parallel
    return !haveDependencies(fileA, fileB)
  }
})
```

### Custom Transaction Handling

```typescript
const driver = new PostgresDriver({
  // ...
  transactionConfig: {
    isolationLevel: 'SERIALIZABLE',
    deferrable: true,
    readOnly: false
  }
})

// Or per-migration
await engine.apply('1.0.0', {
  transaction: {
    isolationLevel: 'READ COMMITTED',
    savepoints: true
  }
})
```

### Progress Tracking

```typescript
await engine.apply('1.0.0', {
  onProgress: (progress) => {
    console.log(`Progress: ${progress.completed}/${progress.total}`)
    console.log(`Current: ${progress.current}`)
    console.log(`Elapsed: ${progress.elapsed}ms`)
  }
})
```

### Dry Run Analysis

```typescript
const plan = await engine.plan('1.0.0')

console.log('Migration plan:')
for (const step of plan.steps) {
  console.log(`- ${step.file} (${step.type})`)
  if (step.analysis) {
    console.log(`  Tables: ${step.analysis.tables.join(', ')}`)
    console.log(`  Operations: ${step.analysis.operations.join(', ')}`)
  }
}

if (plan.risks.length > 0) {
  console.log('\nPotential risks:')
  for (const risk of plan.risks) {
    console.log(`- ${risk.severity}: ${risk.description}`)
  }
}
```

### Middleware

```typescript
const engine = new MigrationEngine({
  // ...
  middleware: [
    // Timing middleware
    async (ctx, next) => {
      const start = Date.now()
      await next()
      const duration = Date.now() - start
      console.log(`Migration took ${duration}ms`)
    },
    
    // Validation middleware
    async (ctx, next) => {
      if (ctx.version.includes('beta') && ctx.env === 'production') {
        throw new Error('Cannot apply beta versions to production')
      }
      await next()
    }
  ]
})
```

## Testing

### Mock Driver

```typescript
import { MockDriver } from '@squizzle/testing'

const mockDriver = new MockDriver({
  appliedVersions: ['1.0.0', '1.1.0'],
  failOn: ['2.0.0'] // Simulate failures
})

const engine = new MigrationEngine({
  driver: mockDriver,
  storage: new MockStorage(),
  security: new MockSecurityProvider()
})

// Test migration
await expect(engine.apply('2.0.0')).rejects.toThrow()
```

### Integration Testing

```typescript
import { TestHelper } from '@squizzle/testing'

describe('Migrations', () => {
  const helper = new TestHelper()
  
  beforeEach(async () => {
    await helper.setup()
  })
  
  afterEach(async () => {
    await helper.teardown()
  })
  
  test('applies migration successfully', async () => {
    const engine = helper.createEngine()
    
    await engine.apply('1.0.0')
    
    const status = await engine.status()
    expect(status.current).toBe('1.0.0')
  })
})
```

## CLI Integration

Use the API in custom scripts:

```typescript
#!/usr/bin/env node
import { MigrationEngine } from '@squizzle/core'
import { createConfig } from './config'

async function main() {
  const config = await createConfig()
  const engine = new MigrationEngine(config)
  
  const command = process.argv[2]
  const version = process.argv[3]
  
  switch (command) {
    case 'apply':
      await engine.apply(version)
      console.log(`Applied ${version}`)
      break
      
    case 'rollback':
      await engine.rollback(version)
      console.log(`Rolled back ${version}`)
      break
      
    case 'status':
      const status = await engine.status()
      console.log(`Current: ${status.current}`)
      break
      
    default:
      console.error(`Unknown command: ${command}`)
      process.exit(1)
  }
}

main().catch(console.error)
```

## Next Steps

- [CLI Reference](./cli.md) - CLI commands
- [Configuration Schema](./config.md) - Configuration options
- [Examples](../../examples/) - Example projects