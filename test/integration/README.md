# Integration Testing Guide

## Overview

The integration test suite validates the complete Squizzle workflow, from initialization through migration application and verification. These tests use real PostgreSQL databases and Docker registries via Testcontainers.

## Prerequisites

- Docker installed and running
- Node.js 18+ 
- At least 4GB of available RAM
- Ports 5432 and 5000 available (or Docker will assign random ports)

## Running Integration Tests

```bash
# Run all integration tests
npm run test:integration

# Run specific test file
npm run test:integration workflow.test.ts

# Run with coverage
npm run test:integration -- --coverage

# Run in watch mode (useful during development)
npm run test:integration -- --watch
```

## Test Structure

### Setup (`setup.ts`)
- Spins up PostgreSQL and Docker Registry containers
- Creates temporary directories for test artifacts
- Provides cleanup functions
- Exports helpers for connection strings

### Helpers (`helpers.ts`)
- `runCliCommand`: Execute CLI commands and capture output
- `createTestMigration`: Create migration files in test directories
- `createTestProject`: Set up complete project structure
- `createSquizzleConfig`: Generate configuration files

### Test Suites

#### Workflow Tests (`workflow.test.ts`)
Tests the complete migration lifecycle:
- Database initialization
- Migration creation and building
- Artifact storage (push/pull)
- Migration application
- Status checking
- Integrity verification

#### Error Handling Tests (`error-handling.test.ts`)
Validates error scenarios:
- Network failures
- Duplicate version applications
- Migration syntax errors and rollback
- Missing directories
- Invalid version formats
- Connection failures
- Corrupted artifacts

#### Performance Tests (`performance.test.ts`)
Benchmarks system performance:
- Large migration handling (100+ tables)
- Build performance with many files
- Integrity verification speed
- Concurrent operations
- Version listing with many entries

## Writing New Integration Tests

### Basic Structure

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { IntegrationTestEnv, setupIntegrationTest } from './setup'
import { runCliCommand, createTestProject } from './helpers'

describe('My Integration Test', () => {
  let testEnv: IntegrationTestEnv
  
  beforeAll(async () => {
    testEnv = await setupIntegrationTest()
  }, 30000) // Container startup timeout
  
  afterAll(async () => {
    await testEnv.cleanup()
  })
  
  it('should do something', async () => {
    // Your test here
  })
})
```

### Best Practices

1. **Isolation**: Each test should create its own project structure
2. **Cleanup**: Always clean up resources in `afterAll`
3. **Timeouts**: Set appropriate timeouts for container operations
4. **Assertions**: Check both exit codes and output content
5. **Error Cases**: Test both success and failure scenarios

### Common Patterns

#### Creating a Test Project
```typescript
await createTestProject(testEnv.tempDir, {
  connectionString: getConnectionString(testEnv.postgres),
  registryUrl: testEnv.registry.url
})
```

#### Running CLI Commands
```typescript
const result = await runCliCommand(['build', '1.0.0', '--notes', 'Test'], {
  cwd: testEnv.tempDir,
  env: { DATABASE_URL: connectionString }
})
expect(result.exitCode).toBe(0)
```

#### Creating Migrations
```typescript
await createTestMigration(testEnv.tempDir, '0001_initial.sql', `
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE
  );
`)
```

## Debugging

### View Container Logs
```typescript
// In your test
const postgres = await new GenericContainer('postgres:15')
  .withLogConsumer(stream => {
    stream.on('data', line => console.log(line))
  })
  .start()
```

### Keep Containers Running
Set `TESTCONTAINERS_RYUK_DISABLED=true` to prevent automatic cleanup:
```bash
TESTCONTAINERS_RYUK_DISABLED=true npm run test:integration
```

### Verbose Output
```bash
# Show all CLI output
NO_COLOR=1 npm run test:integration

# Enable debug logging
DEBUG=squizzle:* npm run test:integration
```

## CI/CD Integration

The integration tests run in GitHub Actions with:
- Ubuntu latest
- PostgreSQL 15
- Docker Registry v2
- 10-minute timeout
- Artifact upload on failure

See `.github/workflows/test.yml` for configuration.

## Performance Benchmarks

Current benchmarks (GitHub Actions runner):
- Full workflow test: ~8-10s
- Large migration (100 tables): ~5-7s  
- Build with 50 files: ~2-3s
- Integrity verification (10k rows): ~1s
- Concurrent operations (10 parallel): ~2s

## Troubleshooting

### Port Conflicts
If you see "address already in use" errors:
```bash
# Find processes using the ports
lsof -i :5432
lsof -i :5000

# Kill if needed
kill -9 <PID>
```

### Docker Issues
```bash
# Ensure Docker is running
docker ps

# Clean up orphaned containers
docker container prune

# Reset Docker (last resort)
docker system prune -a
```

### Test Timeouts
Increase timeouts in `vitest.config.ts`:
```typescript
testTimeout: 120000, // 2 minutes
hookTimeout: 60000,  // 1 minute
```

## Contributing

When adding new integration tests:
1. Follow the existing patterns
2. Document any new helpers
3. Update this README
4. Ensure tests pass locally before pushing
5. Check CI passes before merging