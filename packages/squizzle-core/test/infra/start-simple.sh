#!/bin/bash
# Start simplified Squizzle test infrastructure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting Squizzle test infrastructure (simplified)..."

# Stop any existing containers
docker compose -f docker-compose-simple.yml down 2>/dev/null || true

# Start containers
docker compose -f docker-compose-simple.yml up -d

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
for i in {1..30}; do
  if docker compose -f docker-compose-simple.yml exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    echo "✅ Database is ready!"
    break
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "📍 Test database available at: postgres://postgres:testpass@localhost:54336/squizzle_test"
echo ""
echo "Run './stop-simple.sh' to stop the test infrastructure"