#!/bin/bash
set -e

echo "Setting up integration test database..."

# Wait for PostgreSQL to be ready
for i in {1..30}; do
  if PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d postgres -c "SELECT 1" >/dev/null 2>&1; then
    echo "PostgreSQL is ready"
    break
  fi
  echo "Waiting for PostgreSQL... ($i/30)"
  sleep 2
done

# Create the test database if it doesn't exist
PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d postgres -c "CREATE DATABASE $POSTGRES_DB" 2>/dev/null || true

# Apply system tables
echo "Applying system tables..."
PGPASSWORD=$POSTGRES_PASSWORD psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB -f packages/squizzle-core/sql/system/v1.0.0.sql

echo "Database setup complete"