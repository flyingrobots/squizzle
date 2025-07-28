# Configuration Schema

Complete reference for SQUIZZLE configuration options.

## Configuration File

SQUIZZLE looks for configuration in the following order:

1. `--config` CLI argument
2. `SQUIZZLE_CONFIG` environment variable  
3. `squizzle.config.js` in current directory
4. `squizzle.config.ts` (TypeScript)
5. `.squizzlerc.js`
6. `.squizzlerc.json`
7. `package.json` `squizzle` field

## Schema Reference

### Root Configuration

```typescript
interface SquizzleConfig {
  driver: DriverConfig
  storage: StorageConfig
  security?: SecurityConfig
  paths?: PathsConfig
  build?: BuildConfig
  apply?: ApplyConfig
  rollback?: RollbackConfig
  hooks?: HooksConfig
  environments?: Record<string, SquizzleConfig>
}
```

### Driver Configuration

Configure database connection:

```typescript
interface DriverConfig {
  type: 'postgres' | 'mysql' | 'sqlite'
  config: PostgresConfig | MysqlConfig | SqliteConfig
}

interface PostgresConfig {
  // Connection string (preferred)
  connectionString?: string
  
  // Or individual options
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  
  // Connection pool
  max?: number              // Max connections (default: 10)
  min?: number              // Min connections (default: 0)
  idleTimeoutMillis?: number // Idle timeout (default: 30000)
  connectionTimeoutMillis?: number // Connect timeout (default: 2000)
  
  // SSL options
  ssl?: boolean | {
    rejectUnauthorized?: boolean
    ca?: string              // CA certificate
    cert?: string            // Client certificate  
    key?: string             // Client key
  }
  
  // Other options
  schema?: string           // Schema name (default: 'public')
  searchPath?: string[]     // Schema search path
  applicationName?: string  // Application name
  statement_timeout?: number // Statement timeout in ms
}
```

Example configurations:

```javascript
// Simple connection string
{
  driver: {
    type: 'postgres',
    config: {
      connectionString: 'postgresql://user:pass@localhost:5432/mydb'
    }
  }
}

// Detailed configuration
{
  driver: {
    type: 'postgres',
    config: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      ssl: {
        rejectUnauthorized: true,
        ca: fs.readFileSync('./ca-cert.pem').toString()
      }
    }
  }
}
```

### Storage Configuration

Configure where migration artifacts are stored:

```typescript
interface StorageConfig {
  type: 'oci' | 's3' | 'local'
  config: OciConfig | S3Config | LocalConfig
}

interface OciConfig {
  registry: string          // Registry URL (e.g., 'ghcr.io')
  repository: string        // Repository path
  
  // Authentication
  auth?: {
    username?: string
    password?: string
    token?: string         // Bearer token
  }
  
  // Advanced options
  headers?: Record<string, string>  // Custom headers
  timeout?: number         // Request timeout
  retry?: {
    attempts?: number      // Max retry attempts
    delay?: number         // Initial delay in ms
  }
}

interface S3Config {
  bucket: string
  region?: string
  prefix?: string           // Key prefix
  
  // AWS credentials (uses SDK chain if not provided)
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
  
  // S3 options
  endpoint?: string         // Custom endpoint
  forcePathStyle?: boolean  // Force path style
  signatureVersion?: string // Signature version
}

interface LocalConfig {
  path: string              // Directory path
  compress?: boolean        // Compress artifacts
}
```

Examples:

```javascript
// GitHub Container Registry
{
  storage: {
    type: 'oci',
    config: {
      registry: 'ghcr.io',
      repository: 'myorg/squizzle-migrations',
      auth: {
        username: process.env.GITHUB_USER,
        password: process.env.GITHUB_TOKEN
      }
    }
  }
}

// AWS S3
{
  storage: {
    type: 's3',
    config: {
      bucket: 'my-migrations',
      region: 'us-east-1',
      prefix: 'squizzle/',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    }
  }
}

// Local filesystem (development)
{
  storage: {
    type: 'local',
    config: {
      path: './db/artifacts',
      compress: true
    }
  }
}
```

### Security Configuration

Configure signing and verification:

```typescript
interface SecurityConfig {
  enabled?: boolean         // Enable security features
  provider?: 'sigstore' | 'gpg' | 'custom'
  requireSignature?: boolean // Require signatures on apply
  config?: SignatureProviderConfig
}

interface SigstoreConfig {
  // Public good instance (default)
  fulcio?: string          // Fulcio URL
  rekor?: string           // Rekor URL
  
  // Private instance
  privateInstance?: {
    fulcio: string
    rekor: string
    ctlog?: string         // CT log URL
  }
  
  // OIDC options
  oidc?: {
    issuer?: string
    clientId?: string
  }
}

interface GpgConfig {
  keyId?: string           // GPG key ID
  passphrase?: string      // Key passphrase
  homedir?: string         // GPG home directory
}
```

Examples:

```javascript
// Sigstore with defaults
{
  security: {
    enabled: true,
    provider: 'sigstore'
  }
}

// Sigstore with private instance
{
  security: {
    enabled: true,
    provider: 'sigstore',
    config: {
      privateInstance: {
        fulcio: 'https://fulcio.company.com',
        rekor: 'https://rekor.company.com'
      }
    }
  }
}

// GPG signing
{
  security: {
    enabled: true,
    provider: 'gpg',
    config: {
      keyId: 'me@company.com',
      homedir: '/home/user/.gnupg'
    }
  }
}
```

### Paths Configuration

Configure file locations:

```typescript
interface PathsConfig {
  drizzle?: string         // Drizzle migrations (default: './db/drizzle')
  custom?: string          // Custom migrations (default: './db/squizzle')
  rollback?: string        // Rollback scripts (default: './db/rollback')
  seed?: string            // Seed data (default: './db/seed')
  artifacts?: string       // Build artifacts (default: './db/tarballs')
  cache?: string           // Cache directory (default: './.squizzle/cache')
}
```

Example:

```javascript
{
  paths: {
    drizzle: './migrations/drizzle',
    custom: './migrations/custom',
    rollback: './migrations/rollback',
    seed: './migrations/seed',
    artifacts: './build/migrations'
  }
}
```

### Build Configuration

Configure build behavior:

```typescript
interface BuildConfig {
  compression?: 'gzip' | 'bzip2' | 'none'  // Compression type
  compressionLevel?: number // 1-9 (higher = better compression)
  outputDir?: string        // Output directory
  
  // File handling
  include?: string[]        // Include patterns
  exclude?: string[]        // Exclude patterns
  
  // Metadata
  author?: string           // Default author
  tags?: string[]           // Default tags
  
  // Dependencies
  dependencies?: string[]   // Required versions
  conflicts?: string[]      // Conflicting versions
  
  // Hooks
  preBuild?: string | string[]  // Pre-build commands
  postBuild?: string | string[] // Post-build commands
}
```

Example:

```javascript
{
  build: {
    compression: 'gzip',
    compressionLevel: 9,
    outputDir: './dist/migrations',
    exclude: ['*.test.sql', '*.md'],
    author: 'CI Bot',
    tags: ['auto-generated'],
    preBuild: 'npm run lint:sql',
    postBuild: ['npm run test:migrations', 'echo "Build complete"']
  }
}
```

### Apply Configuration

Configure apply behavior:

```typescript
interface ApplyConfig {
  timeout?: number          // Lock timeout in ms (default: 30000)
  lockKey?: string          // Lock key prefix (default: 'squizzle')
  stopOnError?: boolean     // Stop on first error (default: true)
  
  // Parallelization
  parallel?: boolean        // Allow parallel execution
  maxParallel?: number      // Max parallel migrations (default: 1)
  
  // Transaction handling
  transaction?: boolean     // Wrap in transaction (default: true)
  isolationLevel?: IsolationLevel
  
  // Verification
  verifyChecksum?: boolean  // Verify checksums (default: true)
  verifySignature?: boolean // Verify signatures (default: true)
  
  // Hooks
  beforeEach?: (file: string) => Promise<void>
  afterEach?: (file: string, success: boolean) => Promise<void>
  onError?: (error: Error, file: string) => Promise<void>
}

type IsolationLevel = 
  | 'READ UNCOMMITTED'
  | 'READ COMMITTED'
  | 'REPEATABLE READ'
  | 'SERIALIZABLE'
```

Example:

```javascript
{
  apply: {
    timeout: 60000,
    stopOnError: false,
    parallel: true,
    maxParallel: 5,
    isolationLevel: 'READ COMMITTED',
    beforeEach: async (file) => {
      console.log(`Applying ${file}...`)
    },
    afterEach: async (file, success) => {
      if (!success) {
        await notifyTeam(`Migration ${file} failed`)
      }
    }
  }
}
```

### Rollback Configuration

Configure rollback behavior:

```typescript
interface RollbackConfig {
  requireConfirmation?: boolean  // Require manual confirmation
  maxAge?: string | number      // Max age for rollbacks (e.g., '30d')
  preserveData?: boolean        // Archive data before dropping
  
  // Archive options
  archive?: {
    enabled?: boolean
    schema?: string             // Archive schema name
    prefix?: string             // Table name prefix
  }
  
  // Hooks
  preRollback?: string | string[]
  postRollback?: string | string[]
}
```

Example:

```javascript
{
  rollback: {
    requireConfirmation: true,
    maxAge: '30 days',
    preserveData: true,
    archive: {
      enabled: true,
      schema: 'archive',
      prefix: 'backup_'
    },
    preRollback: 'pg_dump $DATABASE_URL > backup-$(date +%s).sql'
  }
}
```

### Hooks Configuration

Configure lifecycle hooks:

```typescript
interface HooksConfig {
  // Global hooks
  beforeCommand?: string | string[]
  afterCommand?: string | string[]
  
  // Command-specific hooks
  build?: {
    pre?: string | string[]
    post?: string | string[]
  }
  apply?: {
    pre?: string | string[]
    post?: string | string[]
  }
  rollback?: {
    pre?: string | string[]
    post?: string | string[]
  }
}
```

Example:

```javascript
{
  hooks: {
    beforeCommand: 'echo "Running SQUIZZLE command: ${SQUIZZLE_COMMAND}"',
    afterCommand: 'echo "Command completed with exit code: ${SQUIZZLE_EXIT_CODE}"',
    apply: {
      pre: [
        'npm run test:database',
        'curl -X POST https://api.example.com/deployments/start'
      ],
      post: 'curl -X POST https://api.example.com/deployments/complete'
    }
  }
}
```

### Environment-Specific Configuration

Override configuration per environment:

```javascript
{
  // Default configuration
  driver: {
    type: 'postgres',
    config: { host: 'localhost' }
  },
  
  // Environment overrides
  environments: {
    production: {
      driver: {
        config: {
          connectionString: process.env.PROD_DATABASE_URL,
          ssl: { rejectUnauthorized: true }
        }
      },
      security: {
        enabled: true,
        requireSignature: true
      }
    },
    staging: {
      driver: {
        config: {
          connectionString: process.env.STAGING_DATABASE_URL
        }
      }
    }
  }
}
```

## TypeScript Configuration

For TypeScript projects:

```typescript
// squizzle.config.ts
import { defineConfig } from '@squizzle/core'
import { readFileSync } from 'fs'

export default defineConfig({
  driver: {
    type: 'postgres',
    config: {
      connectionString: process.env.DATABASE_URL!,
      ssl: {
        ca: readFileSync('./ca-cert.pem').toString()
      }
    }
  },
  storage: {
    type: 'oci',
    config: {
      registry: 'ghcr.io',
      repository: 'myorg/migrations'
    }
  },
  // Type-safe configuration
  apply: {
    beforeEach: async (file) => {
      console.log(`Applying ${file}`)
    }
  }
})
```

## Schema Validation

SQUIZZLE validates configuration on startup:

```javascript
// Validation errors
{
  driver: {
    type: 'invalid-db'  // Error: Invalid driver type
  },
  storage: {
    config: {
      // Error: Missing required 'repository'
    }
  }
}
```

Test configuration:

```bash
squizzle config validate
```

## Best Practices

### 1. Use Environment Variables

```javascript
{
  driver: {
    config: {
      connectionString: process.env.DATABASE_URL,
      // Fallback for local development
      host: process.env.DB_HOST || 'localhost'
    }
  }
}
```

### 2. Separate Environments

```javascript
// squizzle.config.js
const env = process.env.NODE_ENV || 'development'

module.exports = require(`./config/${env}.js`)
```

### 3. Validate Early

```javascript
// Validate required env vars
const required = ['DATABASE_URL', 'OCI_REGISTRY']
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`)
  }
}
```

### 4. Document Configuration

```javascript
{
  // Database connection for main application data
  driver: {
    type: 'postgres',
    config: {
      // Use connection pooling in production
      max: process.env.NODE_ENV === 'production' ? 20 : 5
    }
  }
}
```

## Next Steps

- [CLI Reference](./cli.md) - Available commands
- [API Reference](./api.md) - Programmatic usage
- [Examples](../../examples/) - Example configurations