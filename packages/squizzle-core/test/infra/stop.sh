#!/bin/bash
# Stop Squizzle test infrastructure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🛑 Stopping Squizzle test infrastructure..."

docker compose down

echo "✅ Test infrastructure stopped"