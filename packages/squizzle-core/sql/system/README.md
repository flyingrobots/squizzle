# Squizzle System SQL Files

This directory contains the SQL files that define Squizzle's internal system tables.

## Overview

Squizzle uses internal tables to track migration versions and manage its own state. These tables are created either:

1. Explicitly via `squizzle init` command
2. Automatically when running `squizzle apply` for the first time (if auto-init is enabled)

## Current Version

- **v1.0.0.sql**: Initial system tables
  - `squizzle_versions`: Tracks all applied migrations with checksums, timestamps, and success status

## System Version Format

System versions use a special format: `system-v{version}` (e.g., `system-v1.0.0`)

This distinguishes them from regular application migrations and ensures they:
- Cannot be rolled back
- Are applied in order
- Are tracked separately via the `is_system` flag

## Security Considerations

- System SQL files use `IF NOT EXISTS` clauses for idempotency
- The init process uses `ON CONFLICT DO NOTHING` to handle re-runs safely
- All operations are wrapped in transactions when possible
- System versions are immutable and cannot be deleted

## Future Versions

When upgrading system tables:

1. Create a new file (e.g., `v1.1.0.sql`) with only the changes
2. Include ALTER TABLE statements, new tables, or new indexes
3. The system will detect and apply upgrades automatically
4. Each upgrade is tracked as a new system version