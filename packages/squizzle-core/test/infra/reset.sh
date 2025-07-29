#!/bin/bash
# Reset Squizzle test database

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔄 Resetting test database..."

# Apply squizzle system tables
docker compose exec -T db psql -U postgres -d squizzle_test < ../../sql/squizzle_system_tables.sql

echo "✅ Database reset complete"