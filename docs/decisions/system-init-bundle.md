# Squizzle System Init Bundle Design

## Decision Record

**Status**: Proposed  
**Date**: 2025-07-28  
**Author**: System Architecture Team  

## Context

Squizzle requires certain database structures (like the `squizzle_versions` table) to exist before it can track migrations. This creates a chicken-and-egg problem: how do you migrate in the table that tracks migrations?

Additionally, test environments need a fast, reliable way to reset the database to a known state between test runs.

## Decision

We will implement a **hybrid approach** that provides both explicit control and automatic safety mechanisms.

## Design

### System Table Management

1. **Explicit Initialization Command**: `squizzle init`
   - Creates all system tables explicitly
   - Similar to `git init` pattern - clear and intentional
   - Returns success if tables already exist (idempotent)

2. **Auto-Bootstrap Safety**
   - On first `squizzle apply`, check if system tables exist
   - If missing, either:
     - Auto-create with clear logging: "Creating Squizzle system tables..."
     - OR fail with helpful message: "System tables not found. Run 'squizzle init' first."
   - Configuration option to control behavior: `auto_init: true/false`

3. **System Table Versioning**
   - Track system version separately in `squizzle_versions` table
   - Special version format: `system-v1.0.0`
   - Allows upgrading Squizzle's internal structures independently
   - System versions are immutable - never rolled back

### File Structure

```
@squizzle/core/
├── sql/
│   ├── system/
│   │   ├── v1.0.0.sql           # Initial system tables
│   │   ├── v1.1.0.sql           # Future upgrade
│   │   └── README.md            # System SQL documentation
│   └── squizzle_system_tables.sql  # Symlink to latest version
```

### System Bundle Contents

```sql
-- Squizzle System Tables v1.0.0
-- DO NOT MODIFY - This file is part of Squizzle's core functionality

-- Create schema if needed (optional, can use public)
-- CREATE SCHEMA IF NOT EXISTS squizzle;

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

-- Add table comments
COMMENT ON TABLE squizzle_versions IS 'Tracks all applied database versions including system versions';
COMMENT ON COLUMN squizzle_versions.is_system IS 'True for Squizzle system migrations, false for application migrations';
```

### CLI Commands

1. **`squizzle init`**
   ```bash
   # Initialize Squizzle system tables in the target database
   squizzle init --database-url postgres://...
   
   # Options:
   #   --force     Recreate system tables even if they exist
   #   --dry-run   Show what would be created
   ```

2. **`squizzle doctor`**
   ```bash
   # Check system health and repair if needed
   squizzle doctor
   
   # Checks:
   # - System tables exist
   # - System version is current
   # - No corruption in version history
   # - Indexes are present
   ```

3. **`squizzle system upgrade`**
   ```bash
   # Upgrade system tables to latest version
   squizzle system upgrade
   
   # Shows what will be upgraded and prompts for confirmation
   ```

### Implementation Details

#### Auto-Bootstrap Logic
```typescript
export async function ensureSystemTables(
  driver: DatabaseDriver, 
  options: { autoInit: boolean }
): Promise<void> {
  const tables = await driver.query(`
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'squizzle_versions'
  `)
  
  if (tables.length === 0) {
    if (!options.autoInit) {
      throw new Error(
        'Squizzle system tables not found. ' +
        'Run "squizzle init" to initialize the database.'
      )
    }
    
    logger.info('Creating Squizzle system tables...')
    const systemSQL = await readSystemBundle('v1.0.0')
    await driver.execute(systemSQL)
    logger.info('System tables created successfully')
  }
}
```

#### Test Environment Setup
```typescript
export async function setupTestDatabase() {
  // Bypass migration engine for speed
  const systemSQL = readFileSync(
    join(__dirname, '../sql/system/v1.0.0.sql'), 
    'utf-8'
  )
  
  // Direct execution
  execSync('psql ... < system.sql')
}

export async function cleanupTestDatabase() {
  // Just truncate, don't drop (faster)
  const sql = `
    TRUNCATE TABLE squizzle_versions CASCADE;
    -- Truncate other test tables
  `
  execSync(`psql ... -c "${sql}"`)
}
```

### Migration Path for Future System Updates

When we need to update system tables (e.g., v1.0.0 → v1.1.0):

1. Create new file: `sql/system/v1.1.0.sql`
2. Include only the changes (ALTER TABLE, etc.)
3. `squizzle doctor` detects outdated system version
4. `squizzle system upgrade` applies the update
5. Records `system-v1.1.0` in versions table

Example upgrade:
```sql
-- Squizzle System Tables v1.1.0
-- Upgrade from v1.0.0

-- Add new column for environment tracking
ALTER TABLE squizzle_versions 
ADD COLUMN IF NOT EXISTS environment VARCHAR(50);

-- Add new system table for distributed locking
CREATE TABLE IF NOT EXISTS squizzle_locks (
  lock_key VARCHAR(255) PRIMARY KEY,
  locked_by VARCHAR(255) NOT NULL,
  locked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

-- Record upgrade
INSERT INTO squizzle_versions (
  version, checksum, applied_by, manifest, is_system
)
VALUES (
  'system-v1.1.0', 'system', 'squizzle-upgrade', 
  '{"type": "system", "upgrade_from": "v1.0.0"}', true
);
```

## Consequences

### Positive
- **Explicit Control**: Users know exactly when system tables are created
- **Safety**: Auto-creation prevents "forgot to init" errors
- **Fast Tests**: Direct SQL execution bypasses overhead
- **Upgradeable**: System can evolve without breaking existing installations
- **Self-Documenting**: Clear commands and version tracking

### Negative
- **Additional Step**: Users must run `squizzle init` (mitigated by auto-init)
- **Complexity**: System versions separate from app versions
- **Testing**: Must ensure test setup matches production system tables

### Neutral
- Similar to other tools (`git init`, `npm init`, `rails db:create`)
- System versions cannot be rolled back (by design)

## Alternatives Considered

1. **Always Auto-Create**: Too magical, hides important setup
2. **Include in First Migration**: Mixes concerns, hard to upgrade
3. **Separate Schema**: Adds complexity, cross-schema queries
4. **External SQL Only**: No version tracking for system itself

## References

- Git's `.git` directory initialization pattern
- Rails database migrations and schema table
- Flyway's schema history table
- Liquibase's DATABASECHANGELOG table