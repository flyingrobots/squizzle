# Configuration

SQUIZZLE uses a configuration file to specify database connections, storage backends, and security settings.

## Configuration File

Create a `squizzle.config.js` file in your project root:

```javascript
module.exports = {
  // Database driver configuration
  driver: {
    type: 'postgres',
    config: {
      connectionString: process.env.DATABASE_URL,
      // or
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.NODE_ENV === 'production'
    }
  },

  // Storage backend for migration artifacts
  storage: {
    type: 'oci',
    config: {
      registry: process.env.OCI_REGISTRY || 'docker.io',
      repository: process.env.OCI_REPOSITORY || 'myorg/squizzle-migrations',
      auth: {
        username: process.env.OCI_USERNAME,
        password: process.env.OCI_PASSWORD
      }
    }
  },

  // Optional security configuration
  security: {
    enabled: process.env.NODE_ENV === 'production',
    provider: 'sigstore',
    config: {
      // Sigstore configuration
    }
  },

  // Migration paths
  paths: {
    drizzle: './db/drizzle',      // Drizzle-generated migrations
    custom: './db/squizzle',       // Custom SQL migrations
    rollback: './db/rollback',     // Rollback scripts
    seed: './db/seed'              // Seed data
  },

  // Build options
  build: {
    compression: 'gzip',
    outputDir: './db/tarballs'
  }
}
```

## TypeScript Configuration

For TypeScript projects, create `squizzle.config.ts`:

```typescript
import { defineConfig } from '@squizzle/core'

export default defineConfig({
  driver: {
    type: 'postgres',
    config: {
      connectionString: process.env.DATABASE_URL!
    }
  },
  // ... rest of configuration
})
```

## Environment Variables

SQUIZZLE supports environment variables for sensitive configuration:

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb

# OCI Registry
OCI_REGISTRY=ghcr.io
OCI_REPOSITORY=myorg/squizzle-migrations
OCI_USERNAME=myuser
OCI_PASSWORD=mytoken

# Security
SQUIZZLE_SIGN_ARTIFACTS=true
```

## Configuration Options

### Driver Configuration

#### PostgreSQL

```javascript
driver: {
  type: 'postgres',
  config: {
    connectionString: 'postgresql://...',
    // Connection pool options
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    // SSL options
    ssl: {
      rejectUnauthorized: false,
      ca: fs.readFileSync('ca-cert.pem')
    }
  }
}
```

### Storage Configuration

#### OCI Registry

```javascript
storage: {
  type: 'oci',
  config: {
    registry: 'docker.io',
    repository: 'myorg/migrations',
    auth: {
      username: 'user',
      password: 'token',
      // or use token auth
      token: 'bearer-token'
    },
    // Optional: custom headers
    headers: {
      'X-Custom-Header': 'value'
    }
  }
}
```

### Security Configuration

#### Sigstore

```javascript
security: {
  enabled: true,
  provider: 'sigstore',
  config: {
    // Use default Fulcio/Rekor instances
    fulcio: 'https://fulcio.sigstore.dev',
    rekor: 'https://rekor.sigstore.dev',
    // Or use private instance
    privateInstance: {
      fulcio: 'https://fulcio.company.com',
      rekor: 'https://rekor.company.com'
    }
  }
}
```

## Multi-Environment Configuration

Use environment-specific configurations:

```javascript
const configs = {
  development: {
    driver: {
      type: 'postgres',
      config: { host: 'localhost' }
    }
  },
  production: {
    driver: {
      type: 'postgres',
      config: { connectionString: process.env.DATABASE_URL }
    }
  }
}

module.exports = configs[process.env.NODE_ENV || 'development']
```

## Configuration Validation

SQUIZZLE validates your configuration on startup. To test your configuration:

```bash
squizzle config validate
```

## Next Steps

- [Your First Migration](./first-migration.md) - Create and apply migrations
- [CLI Commands](./reference/cli.md) - Available commands