#!/bin/bash
# Start Squizzle test infrastructure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting Squizzle test infrastructure..."

# Start containers
docker compose up -d

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
for i in {1..30}; do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    echo "✅ Database is ready!"
    break
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "📍 Test database available at: postgres://postgres:testpass@localhost:54316/squizzle_test"
echo "🔑 Kong API Gateway: http://localhost:54321"
echo ""
echo "Run './stop.sh' to stop the test infrastructure"