-- Squizzle System Tables v1.0.0
-- DO NOT MODIFY - This file is part of Squizzle's core functionality

-- Create schema if needed
CREATE SCHEMA IF NOT EXISTS public;

-- Version tracking table
CREATE TABLE IF NOT EXISTS squizzle_versions (
  id SERIAL PRIMARY KEY,
  version VARCHAR(50) NOT NULL UNIQUE,
  checksum VARCHAR(128) NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  applied_by VARCHAR(255) NOT NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  rollback_of VARCHAR(50),
  manifest JSONB NOT NULL,
  -- System flag to distinguish system versions
  is_system BOOLEAN DEFAULT false
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_squizzle_versions_applied_at 
  ON squizzle_versions(applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_squizzle_versions_success 
  ON squizzle_versions(success);

CREATE INDEX IF NOT EXISTS idx_squizzle_versions_is_system 
  ON squizzle_versions(is_system);

-- Future tables can be added here:
-- squizzle_locks (distributed locking)
-- squizzle_audit (migration audit trail)
-- squizzle_environments (multi-env tracking)

-- Add table comments
COMMENT ON TABLE squizzle_versions IS 'Tracks all applied database versions including system versions';
COMMENT ON COLUMN squizzle_versions.is_system IS 'True for Squizzle system migrations, false for application migrations';

-- Mark system version as applied
INSERT INTO squizzle_versions (
  version, 
  checksum, 
  applied_by, 
  manifest,
  is_system
)
VALUES (
  'system-v1.0.0', 
  'system', 
  'squizzle-init', 
  '{"type": "system", "tables": ["squizzle_versions"]}',
  true
)
ON CONFLICT (version) DO NOTHING;