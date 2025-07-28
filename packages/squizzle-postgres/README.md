# @squizzle/postgres

PostgreSQL driver for SQUIZZLE migrations with advisory lock support.

## Installation

```bash
npm install @squizzle/postgres
```

## Usage

```typescript
import { createPostgresDriver } from '@squizzle/postgres'
import { MigrationEngine } from '@squizzle/core'

const driver = createPostgresDriver({
  connectionString: 'postgres://user:pass@localhost:5432/mydb'
})

const engine = new MigrationEngine({
  driver,
  // ... other options
})
```

## Configuration Options

```typescript
interface PostgresDriverOptions {
  // Option 1: Connection string
  connectionString?: string
  
  // Option 2: Individual parameters
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  
  // Connection pool settings
  max?: number                    // Max pool size (default: 10)
  idleTimeoutMillis?: number     // Idle timeout (default: 30000)
  connectionTimeoutMillis?: number // Connection timeout (default: 2000)
  
  // SSL configuration
  ssl?: boolean | {
    rejectUnauthorized?: boolean
    ca?: string
    key?: string
    cert?: string
  }
  
  // Use existing pool
  pool?: Pool
}
```

## Features

### Advisory Locks

Prevents concurrent migrations using PostgreSQL advisory locks:

```typescript
const unlock = await driver.lock('squizzle_migration', 60000)
try {
  // Perform migration
} finally {
  await unlock()
}
```

### Transaction Support

All migrations run in transactions:

```typescript
await driver.transaction(async (tx) => {
  await tx.execute('CREATE TABLE users (...)')
  await tx.execute('CREATE INDEX ...')
  // If any query fails, entire transaction rolls back
})
```

### Version Tracking

Automatically creates and manages version table:

```sql
CREATE TABLE IF NOT EXISTS squizzle_versions (
  version VARCHAR(50) PRIMARY KEY,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  applied_by VARCHAR(255),
  checksum VARCHAR(64),
  manifest JSONB,
  success BOOLEAN DEFAULT true,
  error TEXT,
  duration_ms INTEGER,
  rollback_of VARCHAR(50)
)
```

## Connection Examples

### Basic Connection

```typescript
const driver = createPostgresDriver({
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  user: 'postgres',
  password: 'secret'
})
```

### Connection String

```typescript
const driver = createPostgresDriver({
  connectionString: process.env.DATABASE_URL
})
```

### SSL Connection

```typescript
const driver = createPostgresDriver({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // For self-signed certificates
    ca: fs.readFileSync('server-ca.pem').toString()
  }
})
```

### Connection Pool

```typescript
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000
})

const driver = createPostgresDriver({ pool })
```

## Error Handling

The driver provides detailed error information:

```typescript
try {
  await driver.execute('INVALID SQL')
} catch (error) {
  if (error.code === '42601') { // Syntax error
    console.error('SQL syntax error:', error.message)
  }
}
```

Common PostgreSQL error codes:
- `23505` - Unique violation
- `23503` - Foreign key violation
- `42P01` - Undefined table
- `42601` - Syntax error
- `42703` - Undefined column

## Best Practices

1. **Use connection pooling** in production:
   ```typescript
   const driver = createPostgresDriver({
     connectionString: DATABASE_URL,
     max: 20, // Adjust based on load
     idleTimeoutMillis: 30000
   })
   ```

2. **Always close connections**:
   ```typescript
   try {
     await driver.connect()
     // ... do work
   } finally {
     await driver.disconnect()
   }
   ```

3. **Handle connection errors**:
   ```typescript
   const driver = createPostgresDriver({
     connectionString: DATABASE_URL,
     connectionTimeoutMillis: 5000 // Fail fast
   })
   ```

4. **Use transactions for multi-statement migrations**:
   ```typescript
   await driver.transaction(async (tx) => {
     await tx.execute('ALTER TABLE ...')
     await tx.execute('UPDATE ...')
     await tx.execute('CREATE INDEX ...')
   })
   ```

## Testing

The driver includes test utilities:

```typescript
import { createTestDriver } from '@squizzle/postgres/test'

const driver = createTestDriver({
  database: 'test_db'
})

// Automatically cleans up after tests
afterEach(async () => {
  await driver.cleanup()
})
```

## License

MIT