# Multi-Environment Example

This example demonstrates managing database migrations across development, staging, and production environments.

## Structure

```
multi-environment/
├── config/
│   ├── development.js
│   ├── staging.js
│   └── production.js
├── db/
│   ├── drizzle/
│   ├── squizzle/
│   └── rollback/
├── squizzle.config.js
├── .env.example
└── README.md
```

## Environment Configuration

### Base Configuration

```javascript
// squizzle.config.js
const env = process.env.NODE_ENV || 'development'
module.exports = require(`./config/${env}.js`)
```

### Development

```javascript
// config/development.js
module.exports = {
  driver: {
    type: 'postgres',
    config: {
      host: 'localhost',
      port: 5432,
      database: 'myapp_dev',
      user: 'developer',
      password: 'localpass'
    }
  },
  storage: {
    type: 'local',
    config: {
      path: './db/artifacts'
    }
  },
  security: {
    enabled: false
  }
}
```

### Staging

```javascript
// config/staging.js
module.exports = {
  driver: {
    type: 'postgres',
    config: {
      connectionString: process.env.STAGING_DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  },
  storage: {
    type: 'oci',
    config: {
      registry: 'ghcr.io',
      repository: process.env.STAGING_MIGRATION_REPO,
      auth: {
        username: process.env.GITHUB_USER,
        password: process.env.GITHUB_TOKEN
      }
    }
  }
}
```

### Production

```javascript
// config/production.js
module.exports = {
  driver: {
    type: 'postgres',
    config: {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: true,
        ca: process.env.DB_CA_CERT
      }
    }
  },
  storage: {
    type: 'oci',
    config: {
      registry: 'ghcr.io',
      repository: process.env.PROD_MIGRATION_REPO,
      auth: {
        username: process.env.GITHUB_USER,
        password: process.env.GITHUB_TOKEN
      }
    }
  },
  security: {
    enabled: true,
    requireSignature: true,
    provider: 'sigstore'
  }
}
```

## Environment Variables

```bash
# .env.example

# Development
DEV_DATABASE_URL=postgresql://localhost:5432/myapp_dev

# Staging
STAGING_DATABASE_URL=postgresql://staging.example.com:5432/myapp_staging
STAGING_MIGRATION_REPO=myorg/migrations-staging

# Production
DATABASE_URL=postgresql://prod.example.com:5432/myapp_prod
PROD_MIGRATION_REPO=myorg/migrations-prod
DB_CA_CERT=-----BEGIN CERTIFICATE-----...

# GitHub Registry
GITHUB_USER=myusername
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

## Workflow

### Development

```bash
# Set environment
export NODE_ENV=development

# Make changes and test locally
npm run db:generate
squizzle build dev-$(git rev-parse --short HEAD) --notes "Testing feature X"
squizzle apply dev-$(git rev-parse --short HEAD)

# Run tests
npm test
```

### Staging Deployment

```bash
# Set environment
export NODE_ENV=staging

# Build and tag for staging
VERSION=1.2.0-rc.1
squizzle build $VERSION --notes "Release candidate for feature X"
squizzle push $VERSION --tag staging

# Apply to staging
squizzle apply $VERSION

# Run integration tests
npm run test:integration
```

### Production Deployment

```bash
# Set environment
export NODE_ENV=production

# Build, sign, and tag for production
VERSION=1.2.0
squizzle build $VERSION --notes "Feature X release" --sign
squizzle push $VERSION --tag production --tag latest

# Apply with confirmation
squizzle apply $VERSION
```

## Version Promotion

```bash
# Promote from staging to production
squizzle pull 1.2.0-rc.1 --env staging
squizzle push 1.2.0 --env production --tag production
squizzle apply 1.2.0 --env production
```

## Environment Isolation

### Separate Registries

```
Development: local filesystem
Staging: ghcr.io/myorg/migrations-staging
Production: ghcr.io/myorg/migrations-prod
```

### Separate Databases

```
Development: myapp_dev (local)
Staging: myapp_staging (cloud)
Production: myapp_prod (cloud, multi-AZ)
```

### Access Control

```yaml
# GitHub repository settings
migrations-staging:
  - Developers: read
  - CI/CD: write
  
migrations-prod:
  - Developers: none
  - Senior devs: read
  - CI/CD: write (production branch only)
```

## Scripts

```json
{
  "scripts": {
    "db:dev": "NODE_ENV=development squizzle",
    "db:staging": "NODE_ENV=staging squizzle",
    "db:prod": "NODE_ENV=production squizzle",
    "deploy:staging": "NODE_ENV=staging npm run db:build && npm run db:push && npm run db:apply",
    "deploy:prod": "NODE_ENV=production npm run db:build && npm run db:push && npm run db:apply"
  }
}
```

## Safety Checks

```javascript
// Prevent accidental production deployments
if (process.env.NODE_ENV === 'production') {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  })
  
  readline.question('Deploy to PRODUCTION? Type "yes" to confirm: ', (answer) => {
    if (answer !== 'yes') {
      console.log('Deployment cancelled')
      process.exit(1)
    }
    readline.close()
  })
}
```

## Monitoring

```javascript
// Track deployments across environments
const deployments = {
  development: { current: 'dev-abc123', updated: '2024-01-20' },
  staging: { current: '1.2.0-rc.1', updated: '2024-01-19' },
  production: { current: '1.1.0', updated: '2024-01-15' }
}

// Alert if environments drift
if (deployments.staging.current !== deployments.production.current) {
  console.warn('⚠️  Staging and production versions differ')
}
```