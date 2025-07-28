# Error Recovery Guide

When migrations fail, this guide helps you diagnose and recover quickly. Time is critical during outages, so we've organized this guide for rapid problem resolution.

## 🚨 Quick Start - Most Common Issues

### Migration Failed Mid-Apply
```bash
# Check current state
squizzle status --detailed

# View specific migration logs
squizzle logs 1.2.3

# Mark as failed and retry
squizzle mark-failed 1.2.3
squizzle apply 1.2.3 --force
```

### Checksum Mismatch Error
```bash
# Verify the checksum difference
squizzle verify 1.2.3

# If migration file was legitimately updated
squizzle apply 1.2.3 --skip-checksum-validation

# Update stored checksum (use with caution)
squizzle update-checksum 1.2.3
```

### Connection Timeout During Apply
```bash
# Increase timeout and retry
squizzle apply 1.2.3 --timeout 600

# Check if migration partially applied
squizzle status 1.2.3 --check-partial
```

## 🔍 Diagnostic Flowchart

Use this decision tree to quickly identify your issue:

```
Migration Failed?
├─ During Apply?
│  ├─ Partial Application? → Section: "Failed Migration Mid-Apply"
│  ├─ Connection Error? → Section: "Connection Issues"
│  └─ SQL Error? → Section: "SQL Syntax Errors"
├─ During Build?
│  ├─ Checksum Error? → Section: "Checksum Mismatches"
│  └─ Storage Error? → Section: "Storage System Failures"
└─ During Rollback?
   └─ → Section: "Rollback Failures"
```

## 📋 Detailed Recovery Procedures

### Failed Migration Mid-Apply

**Symptoms:**
- Migration shows as "applying" in status
- Database changes partially visible
- Subsequent migrations blocked

**Diagnosis:**
```bash
# Check migration status
squizzle status --detailed

# Connect to database and check partial state
psql $DATABASE_URL
```

```sql
-- Check what SQUIZZLE thinks is applied
SELECT * FROM squizzle_versions WHERE version = '1.2.3';

-- Check if tables/columns were created
\dt new_table_name
\d existing_table_name
```

**Recovery Steps:**

1. **Assess the damage:**
```sql
-- List all changes from the migration
SELECT * FROM squizzle_versions WHERE version = '1.2.3';

-- For each DDL statement, check if it was applied
-- Example: If migration creates a table
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'new_table'
);
```

2. **Manual cleanup (if needed):**
```sql
-- If table was partially created, drop it
DROP TABLE IF EXISTS new_table CASCADE;

-- If column was added, remove it
ALTER TABLE existing_table DROP COLUMN IF EXISTS new_column;

-- Clean up any partial indexes
DROP INDEX IF EXISTS idx_name;
```

3. **Reset migration state:**
```sql
-- Mark migration as failed
UPDATE squizzle_versions 
SET status = 'failed', 
    failed_at = NOW(),
    error_message = 'Manual intervention: partial application'
WHERE version = '1.2.3';

-- Clear any locks
DELETE FROM squizzle_locks WHERE version = '1.2.3';
```

4. **Fix and retry:**
```bash
# Review the migration file
cat db/migrations/1.2.3.sql

# Fix any issues, then retry
squizzle apply 1.2.3 --force
```

**Verification:**
```bash
# Confirm successful application
squizzle status 1.2.3

# Verify database state
psql $DATABASE_URL -c "\dt"
```

### Checksum Mismatches

**Symptoms:**
- Error: "Checksum mismatch for migration X"
- Migration file was edited after initial storage
- Cannot apply due to integrity check failure

**Diagnosis:**
```bash
# Compare checksums
squizzle verify 1.2.3 --show-diff

# View stored checksum
squizzle show 1.2.3 --checksum-only
```

**Recovery Steps:**

1. **Determine if change was intentional:**
```bash
# View the differences
diff <(squizzle show 1.2.3 --content) db/migrations/1.2.3.sql

# Check git history
git log -p db/migrations/1.2.3.sql
```

2. **If change was intentional and safe:**
```bash
# Apply with checksum override
squizzle apply 1.2.3 --skip-checksum-validation

# Update stored checksum for future runs
squizzle update-checksum 1.2.3
```

3. **If change was unintentional:**
```bash
# Restore original file from storage
squizzle pull 1.2.3 --output db/migrations/1.2.3.sql

# Or restore from git
git checkout HEAD -- db/migrations/1.2.3.sql
```

**Prevention:**
- Never edit migration files after they're built
- Use new migration files for changes
- Enable pre-commit hooks to prevent accidental edits

### Connection Issues

**Symptoms:**
- Timeout errors during migration
- "Connection refused" or "Connection reset"
- Partial application due to network interruption

**Diagnosis:**
```bash
# Test database connectivity
squizzle ping

# Check connection parameters
echo $DATABASE_URL | sed 's/:[^:]*@/:***@/'

# Test with psql directly
psql $DATABASE_URL -c "SELECT 1"
```

**Recovery Steps:**

1. **Fix connection issues:**
```bash
# Common fixes:
# - Check VPN connection
# - Verify firewall rules
# - Confirm database is running
# - Check connection pool limits
```

2. **Increase timeouts:**
```bash
# Set longer timeout for large migrations
export SQUIZZLE_TIMEOUT=600
squizzle apply 1.2.3 --timeout 600

# Or in config
cat > squizzle.config.js << EOF
export default {
  database: {
    connectionTimeout: 600000,
    statementTimeout: 600000
  }
}
EOF
```

3. **Use connection retry:**
```bash
# Enable automatic retry
squizzle apply 1.2.3 --retry 3 --retry-delay 5
```

### SQL Syntax Errors

**Symptoms:**
- "Syntax error at or near..."
- "Column/table does not exist"
- "Permission denied"

**Diagnosis:**
```bash
# Get detailed error
squizzle logs 1.2.3 --verbose

# Test SQL directly
psql $DATABASE_URL -f db/migrations/1.2.3.sql
```

**Recovery Steps:**

1. **Fix syntax errors:**
```sql
-- Common issues:
-- Missing semicolons
CREATE TABLE test (id INT); -- Don't forget semicolon

-- Wrong quotes
CREATE TABLE "test" (id INT); -- Use double quotes for identifiers
INSERT INTO test VALUES ('value'); -- Use single quotes for strings

-- Missing commas
CREATE TABLE test (
  id INT,  -- Don't forget comma
  name TEXT
);
```

2. **Handle missing dependencies:**
```sql
-- Check if referenced objects exist
SELECT EXISTS (
  SELECT FROM pg_tables 
  WHERE tablename = 'referenced_table'
);

-- Create missing objects or adjust migration order
```

3. **Fix permission issues:**
```sql
-- Check current user
SELECT current_user;

-- Grant necessary permissions
GRANT CREATE ON SCHEMA public TO migration_user;
GRANT ALL ON TABLE existing_table TO migration_user;
```

### Storage System Failures

**Symptoms:**
- "Failed to push to registry"
- "Storage unavailable"
- "Authentication failed"

**Diagnosis:**
```bash
# Test storage connectivity
squizzle storage test

# Check authentication
docker login $REGISTRY_URL

# Verify storage configuration
squizzle config show --storage
```

**Recovery Steps:**

1. **Fix authentication:**
```bash
# Re-authenticate with registry
docker login registry.example.com

# Or use token
export SQUIZZLE_REGISTRY_TOKEN="your-token"
```

2. **Handle storage outages:**
```bash
# Use local storage temporarily
squizzle build 1.2.3 --local-only

# Apply from local storage
squizzle apply 1.2.3 --source local
```

3. **Retry with backoff:**
```bash
# Implement exponential backoff
for i in 1 2 4 8 16; do
  squizzle push 1.2.3 && break
  echo "Retry in ${i}s..."
  sleep $i
done
```

### Concurrent Migration Attempts

**Symptoms:**
- "Migration already in progress"
- "Could not acquire lock"
- Multiple instances trying to migrate

**Diagnosis:**
```sql
-- Check for active locks
SELECT * FROM squizzle_locks;

-- See who holds the lock
SELECT 
  l.*,
  pg_stat_activity.application_name,
  pg_stat_activity.client_addr
FROM squizzle_locks l
LEFT JOIN pg_stat_activity ON l.pid = pg_stat_activity.pid;
```

**Recovery Steps:**

1. **Wait for completion:**
```bash
# Monitor lock status
watch -n 5 'squizzle status --locks'

# Set maximum wait time
squizzle apply 1.2.3 --lock-timeout 300
```

2. **Force unlock (if process died):**
```sql
-- Check if locking process is still alive
SELECT pid, pg_stat_activity.state 
FROM squizzle_locks 
LEFT JOIN pg_stat_activity USING (pid);

-- If process is gone, remove stale lock
DELETE FROM squizzle_locks 
WHERE pid NOT IN (SELECT pid FROM pg_stat_activity);
```

3. **Prevent future conflicts:**
```bash
# Use deployment locks
flock -n /var/lock/squizzle.lock squizzle apply 1.2.3

# Or coordinate through CI/CD
```

### Rollback Failures

**Symptoms:**
- "Rollback script failed"
- "Cannot rollback: no rollback script"
- Data inconsistency after rollback attempt

**Diagnosis:**
```bash
# Check if rollback script exists
ls db/rollback/1.2.3.sql

# Verify rollback is possible
squizzle rollback 1.2.3 --dry-run
```

**Recovery Steps:**

1. **Manual rollback:**
```sql
-- If automated rollback fails, do it manually
BEGIN;

-- Reverse the migration changes
-- Example: If migration created a table
DROP TABLE IF EXISTS new_table CASCADE;

-- If migration added a column
ALTER TABLE existing_table DROP COLUMN IF EXISTS new_column;

-- Update version tracking
DELETE FROM squizzle_versions WHERE version = '1.2.3';

COMMIT;
```

2. **Restore from backup:**
```bash
# If rollback is too complex
pg_restore -d $DATABASE_URL backup_before_migration.dump

# Update SQUIZZLE state to match
squizzle sync --from-database
```

## 📊 SQL Reference

### System Tables Queries

```sql
-- View all applied migrations
SELECT version, applied_at, status, execution_time 
FROM squizzle_versions 
ORDER BY applied_at DESC;

-- Check migration details
SELECT * FROM squizzle_versions WHERE version = '1.2.3';

-- Find failed migrations
SELECT version, failed_at, error_message 
FROM squizzle_versions 
WHERE status = 'failed';

-- Check for locks
SELECT * FROM squizzle_locks;

-- Verify checksums
SELECT v.version, v.checksum, c.file_path, c.checksum as file_checksum
FROM squizzle_versions v
JOIN squizzle_checksums c ON v.version = c.version
WHERE v.checksum != c.checksum;
```

### Emergency Procedures

```sql
-- Force unlock all migrations
TRUNCATE squizzle_locks;

-- Mark all migrations as failed (nuclear option)
UPDATE squizzle_versions SET status = 'failed' WHERE status = 'applying';

-- Reset a specific migration
DELETE FROM squizzle_versions WHERE version = '1.2.3';
DELETE FROM squizzle_checksums WHERE version = '1.2.3';

-- Full system reset (DANGEROUS)
DROP TABLE IF EXISTS squizzle_versions CASCADE;
DROP TABLE IF EXISTS squizzle_checksums CASCADE;
DROP TABLE IF EXISTS squizzle_locks CASCADE;
-- Then run: squizzle init --force
```

### Diagnostic Queries

```sql
-- Check table existence
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE 'squizzle_%';

-- View recent migration activity
SELECT 
  version,
  status,
  applied_at,
  execution_time,
  error_message
FROM squizzle_versions
WHERE applied_at > NOW() - INTERVAL '24 hours'
ORDER BY applied_at DESC;

-- Find long-running migrations
SELECT 
  version,
  execution_time,
  pg_size_pretty(execution_time::bigint) as human_time
FROM squizzle_versions
WHERE execution_time > 60000 -- Over 1 minute
ORDER BY execution_time DESC;
```

## 🛡️ Prevention Best Practices

### Pre-Migration Checklist
- [ ] Backup database before major migrations
- [ ] Test migrations in staging environment
- [ ] Review migration SQL for dangerous operations
- [ ] Check available disk space
- [ ] Verify connection stability
- [ ] Ensure no other migrations are running
- [ ] Have rollback plan ready

### Monitoring Setup
```bash
# Set up alerts for failed migrations
squizzle monitor --alert-on-failure

# Log all migration activity
export SQUIZZLE_LOG_LEVEL=debug
export SQUIZZLE_LOG_FILE=/var/log/squizzle.log

# Enable metrics collection
export SQUIZZLE_METRICS_ENABLED=true
```

### Safe Migration Patterns
```sql
-- Use transactions for DDL when possible
BEGIN;
CREATE TABLE new_table (...);
CREATE INDEX idx_new_table ON new_table(...);
COMMIT;

-- Add columns with defaults carefully
ALTER TABLE large_table ADD COLUMN new_col INT;
-- Then update in batches to avoid locks

-- Create indexes concurrently
CREATE INDEX CONCURRENTLY idx_name ON table(column);
```

## 🆘 When to Escalate

Escalate to senior staff or database administrators when:

1. **Data Loss Risk**: Any situation where data might be permanently lost
2. **Production Down**: Extended outage affecting users
3. **Corruption Suspected**: System tables show inconsistencies
4. **Multiple Failures**: Same migration fails repeatedly despite fixes
5. **Security Breach**: Any indication of unauthorized access

### Escalation Information to Provide

```bash
# Gather system state
squizzle diagnostics --full > diagnostics.log

# Include:
# - Exact error messages
# - Steps taken so far
# - Current database state
# - Time pressure/impact
# - Affected versions
```

## 📚 Additional Resources

- [Migration Best Practices](../concepts/migrations.md)
- [Disaster Recovery Guide](./disaster-recovery.md)
- [Rollback Strategies](./rollbacks.md)
- [SQUIZZLE Architecture](../architecture.md)

---

Remember: Stay calm, work methodically, and always test recovery procedures in a non-production environment first when possible.