# Multi-Environment Setup

Configure SQUIZZLE to manage database migrations across development, staging, and production environments.

## Environment Overview

Typical environment setup:

```
Development → Staging → Production
    ↓           ↓          ↓
  Local DB   Cloud DB   Cloud DB
    ↓           ↓          ↓
  Latest     Tested    Stable
```

## Configuration Per Environment

### Environment-Specific Configs

```javascript
// squizzle.config.js
const configs = {
  development: {
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
      enabled: false  // No signing locally
    }
  },
  
  staging: {
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
        repository: 'myorg/migrations-staging',
        auth: {
          username: process.env.GITHUB_USER,
          password: process.env.GITHUB_TOKEN
        }
      }
    }
  },
  
  production: {
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
        repository: 'myorg/migrations-prod',
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
}

module.exports = configs[process.env.NODE_ENV || 'development']
```

### Using Environment Variables

```bash
# .env.development
NODE_ENV=development
DATABASE_URL=postgresql://localhost:5432/myapp_dev

# .env.staging  
NODE_ENV=staging
DATABASE_URL=postgresql://staging.example.com:5432/myapp_staging
OCI_REGISTRY=ghcr.io
OCI_REPOSITORY=myorg/migrations-staging

# .env.production
NODE_ENV=production
DATABASE_URL=postgresql://prod.example.com:5432/myapp_prod
OCI_REGISTRY=ghcr.io  
OCI_REPOSITORY=myorg/migrations-prod
SQUIZZLE_REQUIRE_SIGNATURE=true
```

## Version Promotion Strategy

### 1. Git Flow Approach

```
feature/* → develop → staging → main
    ↓          ↓         ↓        ↓
  Local      Dev DB   Stage DB  Prod DB
```

```bash
# Development
git checkout develop
squizzle build dev-$(git rev-parse --short HEAD)
squizzle apply dev-$(git rev-parse --short HEAD)

# Staging  
git checkout staging
git merge develop
squizzle build staging-$(git rev-parse --short HEAD)
squizzle apply staging-$(git rev-parse --short HEAD)

# Production
git checkout main
git merge staging
git tag v1.2.0
squizzle build 1.2.0 --sign
squizzle apply 1.2.0
```

### 2. Environment Tags

Use registry tags for promotion:

```bash
# Build once
squizzle build 1.2.0

# Tag for environments
squizzle tag 1.2.0 dev
squizzle tag 1.2.0 staging
squizzle tag 1.2.0 production  # After testing
```

### 3. Separate Repositories

Isolate environments completely:

```javascript
// Environment-specific repositories
const repos = {
  development: 'myorg/migrations-dev',
  staging: 'myorg/migrations-staging',
  production: 'myorg/migrations-prod'
}
```

## Environment Isolation

### Database Separation

```sql
-- Separate databases
CREATE DATABASE myapp_dev;
CREATE DATABASE myapp_staging;
CREATE DATABASE myapp_prod;

-- Or separate schemas
CREATE SCHEMA dev;
CREATE SCHEMA staging;
CREATE SCHEMA prod;
```

### User Permissions

```sql
-- Development: Full access
CREATE USER dev_user WITH PASSWORD '...';
GRANT ALL ON DATABASE myapp_dev TO dev_user;

-- Staging: Limited access  
CREATE USER staging_user WITH PASSWORD '...';
GRANT CONNECT ON DATABASE myapp_staging TO staging_user;
GRANT USAGE ON SCHEMA public TO staging_user;
GRANT CREATE ON SCHEMA public TO staging_user;

-- Production: Minimal access
CREATE USER prod_migrator WITH PASSWORD '...';
GRANT CONNECT ON DATABASE myapp_prod TO prod_migrator;
-- Grant specific permissions per migration
```

### Network Isolation

```yaml
# docker-compose.yml
services:
  db-dev:
    image: postgres:15
    networks:
      - dev-network
    ports:
      - "5432:5432"
      
  db-staging:
    image: postgres:15
    networks:
      - staging-network
    ports:
      - "5433:5432"
      
networks:
  dev-network:
    driver: bridge
  staging-network:
    driver: bridge
```

## Migration Workflow

### Development Workflow

```bash
# 1. Make schema changes
edit lib/db/schema.ts

# 2. Generate migrations
npx drizzle-kit generate

# 3. Test locally
squizzle build dev-local --notes "Testing new feature"
squizzle apply dev-local

# 4. Run tests
npm test

# 5. If tests pass, commit
git add .
git commit -m "Add user preferences table"
```

### Staging Workflow

```yaml
# .github/workflows/staging-deploy.yml
name: Deploy to Staging

on:
  push:
    branches: [staging]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      
      - name: Build migration
        run: |
          VERSION="staging-${GITHUB_SHA:0:7}"
          squizzle build $VERSION
          
      - name: Run integration tests
        run: |
          docker-compose up -d db-test
          squizzle apply $VERSION --env test
          npm run test:integration
          
      - name: Deploy to staging
        run: |
          squizzle apply $VERSION --env staging
          
      - name: Run smoke tests
        run: npm run test:staging
```

### Production Workflow

```yaml
# .github/workflows/production-deploy.yml
name: Deploy to Production

on:
  release:
    types: [published]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name }}
          
      - name: Verify staging deployment
        run: |
          STAGING_VERSION=$(squizzle status --env staging --json | jq -r .current)
          echo "Staging at version: $STAGING_VERSION"
          
      - name: Build and sign
        run: |
          squizzle build ${{ github.event.release.tag_name }} --sign
          
      - name: Deploy to production
        run: |
          squizzle apply ${{ github.event.release.tag_name }} --env production
          
      - name: Verify deployment
        run: |
          squizzle status --env production
          npm run test:production
```

## Environment-Specific Features

### Development Features

```sql
-- db/squizzle/dev-only/seed-data.sql
-- Only applied in development
INSERT INTO users (email, role) VALUES
  ('admin@example.com', 'admin'),
  ('user@example.com', 'user'),
  ('test@example.com', 'user');
```

```javascript
// squizzle.config.js
if (process.env.NODE_ENV === 'development') {
  config.paths.seed = './db/squizzle/dev-only'
}
```

### Staging Features

```sql
-- Enable query logging in staging
ALTER SYSTEM SET log_statement = 'all';
ALTER SYSTEM SET log_duration = on;
SELECT pg_reload_conf();
```

### Production Features

```sql
-- Production-only optimizations
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET effective_cache_size = '12GB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
```

## Environment Variables Reference

### Required Variables

| Variable | Development | Staging | Production | Description |
|----------|------------|---------|------------|-------------|
| NODE_ENV | development | staging | production | Environment name |
| DATABASE_URL | Required | Required | Required | Database connection |
| OCI_REGISTRY | Optional | Required | Required | Registry URL |
| OCI_USERNAME | Optional | Required | Required | Registry auth |
| OCI_PASSWORD | Optional | Required | Required | Registry auth |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| SQUIZZLE_CONFIG | ./squizzle.config.js | Config file path |
| SQUIZZLE_TIMEOUT | 30000 | Lock timeout (ms) |
| SQUIZZLE_REQUIRE_SIGNATURE | false | Require signed artifacts |
| SQUIZZLE_LOG_LEVEL | info | Logging verbosity |

## Monitoring Across Environments

### Environment Dashboard

```sql
-- Create monitoring view
CREATE VIEW squizzle.environment_status AS
SELECT 
  current_setting('application_name') as environment,
  MAX(applied_at) as last_migration,
  COUNT(*) as total_migrations,
  COUNT(CASE WHEN success THEN 1 END) as successful,
  COUNT(CASE WHEN NOT success THEN 1 END) as failed
FROM squizzle_history
GROUP BY 1;
```

### Cross-Environment Comparison

```bash
# Compare environments
squizzle compare staging production

# Output
Environment  Current Version  Last Applied
staging      1.2.0-rc.1      2024-01-20 10:30:00
production   1.1.0           2024-01-15 14:00:00

Staging ahead by:
  - 1.2.0-beta.1: Add analytics tables
  - 1.2.0-rc.1: Performance indexes
```

## Best Practices

### 1. Environment Parity

Keep environments as similar as possible:

```javascript
// Base configuration
const baseConfig = {
  driver: { type: 'postgres' },
  paths: {
    drizzle: './db/drizzle',
    custom: './db/squizzle'
  }
}

// Environment overrides
const configs = {
  development: {
    ...baseConfig,
    driver: { ...baseConfig.driver, config: { host: 'localhost' } }
  },
  production: {
    ...baseConfig,
    security: { enabled: true }
  }
}
```

### 2. Progressive Rollout

```bash
# Deploy progressively
squizzle apply 1.2.0 --env development
# Wait 1 day
squizzle apply 1.2.0 --env staging  
# Wait 3 days
squizzle apply 1.2.0 --env production
```

### 3. Environment Locks

Prevent accidental deployments:

```javascript
// Production requires explicit confirmation
if (process.env.NODE_ENV === 'production') {
  const confirm = await prompt('Deploy to PRODUCTION? Type "yes":')
  if (confirm !== 'yes') {
    console.log('Deployment cancelled')
    process.exit(1)
  }
}
```

### 4. Backup Before Deploy

```bash
# Automatic backup before production deploy
if [ "$ENVIRONMENT" = "production" ]; then
  pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql
fi
squizzle apply $VERSION
```

### 5. Environment Documentation

```markdown
# Environment Setup

## Development
- Local PostgreSQL 15
- No SSL required
- Reset daily
- Seed data included

## Staging
- AWS RDS PostgreSQL 15
- SSL required
- Mirrors production
- Reset weekly

## Production
- AWS RDS PostgreSQL 15 Multi-AZ
- SSL required, cert pinning
- Daily backups
- 99.9% uptime SLA
```

## Troubleshooting

### Version Mismatch

```bash
Error: Version 1.2.0 not found in production registry
```

Ensure version is promoted:
```bash
squizzle push 1.2.0 --env production
```

### Connection Issues

```bash
Error: Connection timeout to staging database
```

Check environment-specific settings:
- Firewall rules
- SSL certificates
- Connection strings

### Permission Denied

```bash
Error: Permission denied to create table
```

Verify environment user permissions:
```sql
\du staging_user  -- Check roles
\l myapp_staging  -- Check database access
```

## Next Steps

- [CI/CD Integration](./cicd.md) - Automated deployments
- [Disaster Recovery](./disaster-recovery.md) - Environment recovery
- [Configuration Reference](../reference/config.md) - All options