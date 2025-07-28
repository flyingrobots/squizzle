# Squizzle Test Infrastructure

This directory contains the test infrastructure for Squizzle, based on a minimal Supabase stack to enable testing of RLS and other PostgreSQL features.

## Prerequisites

- Docker and Docker Compose installed
- Port 54316 available (PostgreSQL)
- Port 54321 available (Kong API Gateway)

## Quick Start

1. Start the test infrastructure:
   ```bash
   cd test/infra
   ./start.sh
   ```

2. Run tests:
   ```bash
   cd ../.. # back to squizzle-core
   npm test
   ```

3. Stop the infrastructure when done:
   ```bash
   cd test/infra
   ./stop.sh
   ```

## Database Connection

- **Host**: localhost
- **Port**: 54316
- **Database**: squizzle_test
- **User**: postgres
- **Password**: testpass
- **Connection string**: `postgres://postgres:testpass@localhost:54316/squizzle_test`

## Infrastructure Components

- **PostgreSQL 15.8**: Main database with Supabase extensions
- **Kong**: API Gateway for Supabase-compatible routing
- **GoTrue**: Authentication service
- **PostgREST**: RESTful API for PostgreSQL

## Test Database Reset

The test setup automatically:
1. Creates the `squizzle_versions` table before each test suite
2. Cleans up test data between tests
3. Ensures a clean state for each test

## Manual Database Operations

Reset the database manually:
```bash
cd test/infra
./reset.sh
```

Connect to the test database:
```bash
docker compose exec db psql -U postgres -d squizzle_test
```

## Troubleshooting

If tests fail with connection errors:
1. Ensure Docker is running
2. Check if the test infrastructure is running: `cd test/infra && docker compose ps`
3. Restart the infrastructure: `./stop.sh && ./start.sh`