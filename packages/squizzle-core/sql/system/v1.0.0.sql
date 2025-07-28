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

-- Add comments
COMMENT ON TABLE squizzle_versions IS 'Tracks all applied database versions including system versions';
COMMENT ON COLUMN squizzle_versions.version IS 'Semantic version string (e.g., 1.0.0) or system version (e.g., system-v1.0.0)';
COMMENT ON COLUMN squizzle_versions.checksum IS 'SHA256 checksum of the migration artifact';
COMMENT ON COLUMN squizzle_versions.applied_at IS 'Timestamp when the version was applied';
COMMENT ON COLUMN squizzle_versions.applied_by IS 'User or system that applied the migration';
COMMENT ON COLUMN squizzle_versions.success IS 'Whether the migration was successful';
COMMENT ON COLUMN squizzle_versions.error IS 'Error message if migration failed';
COMMENT ON COLUMN squizzle_versions.rollback_of IS 'Version this migration rolls back, if applicable';
COMMENT ON COLUMN squizzle_versions.manifest IS 'Full manifest of the migration artifact';
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