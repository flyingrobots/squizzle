# Rollback Strategies

SQUIZZLE provides multiple strategies for safely rolling back database migrations when issues arise.

## Understanding Rollbacks

### What Rollbacks Can and Cannot Do

**Can do:**
- Reverse schema changes (DROP tables, columns)
- Restore previous constraints
- Revert function/procedure changes
- Undo index modifications

**Cannot do:**
- Restore deleted data
- Undo data transformations
- Fix application-level issues
- Reverse irreversible operations

## Rollback Scripts

### Creating Rollback Scripts

For every forward migration, create a corresponding rollback:

```sql
-- db/drizzle/0001_create_users.sql (Forward)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
```

```sql
-- db/rollback/0001_rollback_users.sql (Rollback)
DROP INDEX IF EXISTS idx_users_email;
DROP TABLE IF EXISTS users;
```

### Rollback Best Practices

1. **Use IF EXISTS** - Make rollbacks idempotent
2. **Reverse order** - Undo changes in reverse
3. **Preserve data** - Archive before dropping
4. **Test rollbacks** - Verify they work

### Complex Rollbacks

For data-preserving rollbacks:

```sql
-- Forward: Add NOT NULL constraint
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;

-- Rollback: Remove constraint (simple)
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
```

```sql
-- Forward: Split name into first/last
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
UPDATE users SET 
  first_name = split_part(full_name, ' ', 1),
  last_name = split_part(full_name, ' ', 2);
ALTER TABLE users DROP COLUMN full_name;

-- Rollback: Restore full_name
ALTER TABLE users ADD COLUMN full_name TEXT;
UPDATE users SET full_name = concat(first_name, ' ', last_name);
ALTER TABLE users DROP COLUMN first_name;
ALTER TABLE users DROP COLUMN last_name;
```

## Rollback Execution

### Basic Rollback

```bash
# Rollback specific version
squizzle rollback 1.2.0

# Output
✓ Verifying version 1.2.0 is applied...
✓ Loading rollback scripts...
✓ Executing rollbacks:
  ✓ rollback/03_rollback_analytics.sql
  ✓ rollback/02_rollback_functions.sql  
  ✓ rollback/01_rollback_tables.sql
✓ Recording rollback...
✓ Rollback complete
```

### Rollback Options

```bash
# Dry run - preview without executing
squizzle rollback 1.2.0 --dry-run

# Force - skip safety checks
squizzle rollback 1.2.0 --force

# Partial - rollback specific files
squizzle rollback 1.2.0 --only rollback/01_tables.sql
```

## Rollback Strategies

### 1. Immediate Rollback

For critical issues, rollback immediately:

```bash
# Deploy went wrong
squizzle apply 2.0.0
# Error: Foreign key constraint violation

# Immediate rollback
squizzle rollback 2.0.0
```

### 2. Blue-Green Rollback

Maintain two database versions:

```sql
-- Version 1.0.0 (Blue - Current)
CREATE TABLE users_v1 (...);

-- Version 2.0.0 (Green - New)
CREATE TABLE users_v2 (...);
CREATE VIEW users AS SELECT * FROM users_v2;

-- Rollback: Switch view back
CREATE OR REPLACE VIEW users AS SELECT * FROM users_v1;
```

### 3. Feature Flag Rollback

Control features without schema changes:

```sql
-- Add feature flag
ALTER TABLE organizations 
  ADD COLUMN features JSONB DEFAULT '{}';

-- Enable feature
UPDATE organizations 
  SET features = features || '{"new_dashboard": true}';

-- Rollback: Disable feature
UPDATE organizations 
  SET features = features || '{"new_dashboard": false}';
```

### 4. Backward Compatible Changes

Make changes that don't require rollback:

```sql
-- Instead of renaming column (breaking)
ALTER TABLE users RENAME COLUMN email TO email_address;

-- Add new column and migrate gradually
ALTER TABLE users ADD COLUMN email_address TEXT;
UPDATE users SET email_address = email;
-- Later: drop old column
```

## Data Preservation

### Archive Before Dropping

```sql
-- Rollback script with archival
BEGIN;

-- Archive data
CREATE TABLE archive.users_backup_${timestamp} AS 
  SELECT * FROM users;

-- Add metadata
COMMENT ON TABLE archive.users_backup_${timestamp} IS 
  'Backup before rollback of version 2.0.0 on ${date}';

-- Then drop
DROP TABLE users;

COMMIT;
```

### Soft Deletes

Instead of dropping, mark as deleted:

```sql
-- Instead of DROP TABLE
ALTER TABLE old_feature ADD COLUMN deleted_at TIMESTAMPTZ;
UPDATE old_feature SET deleted_at = NOW();

-- Hide from application
CREATE OR REPLACE VIEW active_tables AS
  SELECT table_name 
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name NOT IN (
    SELECT table_name FROM deleted_tables
  );
```

## Testing Rollbacks

### Local Testing

Always test rollbacks locally:

```bash
# Apply migration
squizzle apply 1.2.0 --env local

# Verify application works
npm test

# Test rollback
squizzle rollback 1.2.0 --env local

# Verify application still works
npm test
```

### Automated Testing

```yaml
# .github/workflows/test-rollback.yml
- name: Test rollback
  run: |
    # Apply migration
    squizzle apply $VERSION
    
    # Run smoke tests
    npm run test:smoke
    
    # Rollback
    squizzle rollback $VERSION
    
    # Verify rollback
    npm run test:smoke
```

### Rollback Verification

```sql
-- Create verification function
CREATE FUNCTION verify_rollback() RETURNS BOOLEAN AS $$
DECLARE
  missing_tables INT;
  missing_columns INT;
BEGIN
  -- Check expected schema
  SELECT COUNT(*) INTO missing_tables
  FROM expected_tables et
  LEFT JOIN information_schema.tables t
    ON t.table_name = et.table_name
  WHERE t.table_name IS NULL;
  
  RETURN missing_tables = 0;
END;
$$ LANGUAGE plpgsql;
```

## Rollback Monitoring

### Track Rollback Events

```sql
-- Rollback tracking
CREATE TABLE squizzle.rollback_history (
  id SERIAL PRIMARY KEY,
  version VARCHAR(50) NOT NULL,
  rolled_back_at TIMESTAMPTZ DEFAULT NOW(),
  rolled_back_by VARCHAR(255),
  reason TEXT,
  success BOOLEAN,
  error_message TEXT
);

-- Trigger on rollback
CREATE TRIGGER track_rollback
AFTER INSERT ON squizzle_history
FOR EACH ROW
WHEN (NEW.version LIKE 'rollback-%')
EXECUTE FUNCTION record_rollback();
```

### Alert on Rollbacks

```javascript
// Monitor for rollbacks
const checkRollbacks = async () => {
  const result = await db.query(`
    SELECT * FROM squizzle.rollback_history
    WHERE rolled_back_at > NOW() - INTERVAL '1 hour'
  `)
  
  if (result.rows.length > 0) {
    await sendAlert({
      severity: 'high',
      message: `Rollback detected: ${result.rows[0].version}`,
      details: result.rows[0]
    })
  }
}
```

## Rollback Recovery

### When Rollback Fails

If a rollback fails:

1. **Don't panic** - Assess the situation
2. **Check partial state** - What succeeded/failed?
3. **Manual intervention** - Fix specific issues
4. **Document steps** - For post-mortem

```bash
# Check what was rolled back
squizzle status --detailed

# See which scripts ran
SELECT * FROM squizzle_history 
WHERE version LIKE 'rollback-%'
ORDER BY applied_at DESC;

# Manually complete rollback
psql $DATABASE_URL -f rollback/remaining_script.sql
```

### Point-in-Time Recovery

For critical data:

```bash
# Restore from backup
pg_restore -d mydb backup_before_migration.sql

# Or use PostgreSQL PITR
SELECT pg_create_restore_point('before_rollback');
```

## Rollback Strategies by Change Type

### Schema Changes

| Change Type | Rollback Strategy | Data Loss Risk |
|------------|------------------|----------------|
| ADD TABLE | DROP TABLE | High - Archive first |
| DROP TABLE | Restore from backup | None if backed up |
| ADD COLUMN | DROP COLUMN | Medium - Check usage |
| DROP COLUMN | Restore from backup | None if backed up |
| ALTER TYPE | Complex - may need ETL | Potential precision loss |

### Data Changes

```sql
-- For data modifications, capture original state
CREATE TABLE audit.data_changes (
  id SERIAL PRIMARY KEY,
  version VARCHAR(50),
  table_name TEXT,
  operation TEXT,
  old_data JSONB,
  new_data JSONB,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Use in migration
WITH old_data AS (
  SELECT id, column_value FROM my_table
)
INSERT INTO audit.data_changes (version, table_name, operation, old_data)
SELECT '1.2.0', 'my_table', 'UPDATE', 
  jsonb_build_object('id', id, 'old_value', column_value)
FROM old_data;
```

## Best Practices

### 1. Always Include Rollbacks

```bash
# Build fails without rollback scripts
$ squizzle build 1.0.0
✗ Error: No rollback scripts found
  Hint: Add rollback scripts to db/rollback/
```

### 2. Test Both Directions

```bash
# Test forward and backward
./scripts/test-migration.sh 1.2.0
✓ Applied 1.2.0
✓ Application tests pass
✓ Rolled back 1.2.0  
✓ Application tests pass
```

### 3. Document Rollback Impact

```sql
-- rollback/01_users.sql
/*
 * ROLLBACK: Remove users table
 * WARNING: This will delete all user data
 * PREREQUISITES: Archive users table first
 * IMPACT: Authentication will be unavailable
 */
DROP TABLE IF EXISTS users CASCADE;
```

### 4. Gradual Rollback

For large changes, rollback gradually:

```bash
# Rollback in stages
squizzle rollback 2.0.0 --only rollback/01_features.sql
# Test
squizzle rollback 2.0.0 --only rollback/02_data.sql
# Test
squizzle rollback 2.0.0 --only rollback/03_schema.sql
```

### 5. Rollback Window

Define how long rollbacks are supported:

```javascript
// squizzle.config.js
module.exports = {
  rollback: {
    maxAge: '30 days',  // Can't rollback older versions
    requireApproval: true,  // Manual confirmation
    preserveData: true  // Always archive
  }
}
```

## Next Steps

- [Disaster Recovery](./disaster-recovery.md) - When rollbacks aren't enough
- [Multi-Environment Setup](./environments.md) - Environment-specific rollbacks
- [Testing Guide](../testing/guide.md) - Testing migrations and rollbacks