-- Squizzle System Tables v1.0.0
-- DO NOT MODIFY - This file is part of Squizzle's core functionality

-- Create squizzle schema for system tables
CREATE SCHEMA IF NOT EXISTS squizzle;

-- Version tracking table in squizzle schema
CREATE TABLE IF NOT EXISTS squizzle.versions (
  id SERIAL PRIMARY KEY,
  version VARCHAR(50) NOT NULL UNIQUE,
  checksum VARCHAR(128) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  applied_by VARCHAR(255) NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  rollback_of VARCHAR(50),
  manifest JSONB NOT NULL
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_squizzle_versions_applied_at 
  ON squizzle.versions(applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_squizzle_versions_success 
  ON squizzle.versions(success);

-- Future tables can be added here:
-- squizzle.locks (distributed locking)
-- squizzle.audit (migration audit trail)
-- squizzle.environments (multi-env tracking)

-- Add table comments
COMMENT ON TABLE squizzle.versions IS 'Tracks all applied database versions';
COMMENT ON SCHEMA squizzle IS 'Squizzle system schema - contains migration tracking and other system tables';

-- Mark system version as applied
INSERT INTO squizzle.versions (
  version, 
  checksum, 
  applied_by, 
  manifest
)
VALUES (
  'system-v1.0.0', 
  'system', 
  'squizzle-init', 
  '{"type": "system", "tables": ["squizzle.versions"]}'
)
ON CONFLICT (version) DO NOTHING;